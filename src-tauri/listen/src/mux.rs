//! One MP4 from the drill's two downloads: the video's picture (H.264,
//! no sound) and the chosen language's sound (AAC), so a single media
//! element plays both with nothing to keep in step. Pure byte work
//! like `fmp4`: each track's sample data is copied, never re-encoded,
//! and its codec setup (`stsd`), edit list and headers come along.
//!
//! The output is a plain MP4 (`ftyp`, `moov` with both sample tables,
//! one `mdat`), the picture as track 1 and the sound as track 2, their
//! chunks interleaved by time. Both tracks start at the movie's zero,
//! so a time in the sound file is the same time here: the captions,
//! the clips and the recognizer's word times all carry over.

use crate::fmp4::{
    boxes, child, ftyp, mdat_header, read_track, rebuild, scale_and_duration, u32_at, u64_at,
    Layout, Track,
};

fn put_u32(b: &mut [u8], at: usize, v: u32) -> Option<()> {
    b.get_mut(at..at + 4)?.copy_from_slice(&v.to_be_bytes());
    Some(())
}

fn put_u64(b: &mut [u8], at: usize, v: u64) -> Option<()> {
    b.get_mut(at..at + 8)?.copy_from_slice(&v.to_be_bytes());
    Some(())
}

/// Where a copied box's payload starts (after a 32- or 64-bit size).
fn payload(b: &[u8]) -> usize {
    if u32_at(b, 0) == Some(1) {
        16
    } else {
        8
    }
}

/// `v` from timescale `from` to `to`, rounded.
fn rescale(v: u64, from: u32, to: u32) -> u64 {
    if from == to || from == 0 {
        return v;
    }
    ((u128::from(v) * u128::from(to) + u128::from(from) / 2) / u128::from(from)) as u64
}

/// How one track's boxes change on the way into the muxed movie.
struct Retrack {
    id: u32,
    /// The source movie's timescale (tkhd and elst durations count in
    /// it) and the muxed movie's.
    from: u32,
    to: u32,
    /// The track's length in its media timescale.
    media: u64,
    media_scale: u32,
    /// Its presented length in the muxed movie's timescale.
    shown: u64,
}

impl Retrack {
    fn patch(&self, kind: &[u8; 4], b: &mut [u8]) -> Option<()> {
        let at = payload(b);
        let v1 = *b.get(at)? == 1;
        match kind {
            b"tkhd" => {
                if v1 {
                    put_u32(b, at + 20, self.id)?;
                    put_u64(b, at + 28, self.shown)?;
                } else {
                    put_u32(b, at + 12, self.id)?;
                    put_u32(b, at + 20, u32::try_from(self.shown).ok()?)?;
                }
            }
            b"mdhd" => {
                // Fragmented sources often leave this at zero.
                if v1 {
                    put_u64(b, at + 24, self.media)?;
                } else if let Ok(d) = u32::try_from(self.media) {
                    put_u32(b, at + 16, d)?;
                }
            }
            b"elst" => {
                let count = u32_at(b, at + 4)? as usize;
                let width = if v1 { 20 } else { 12 };
                for k in 0..count {
                    let e = at + 8 + k * width;
                    let (dur, time) = if v1 {
                        (u64_at(b, e)?, u64_at(b, e + 8)? as i64)
                    } else {
                        (
                            u64::from(u32_at(b, e)?),
                            i64::from(u32_at(b, e + 4)? as i32),
                        )
                    };
                    // A zero-length last edit means "the rest" in a
                    // fragmented file; a plain one needs it spelled out.
                    let dur = if dur == 0 && k + 1 == count && time >= 0 {
                        rescale(
                            self.media.saturating_sub(time as u64),
                            self.media_scale,
                            self.to,
                        )
                    } else {
                        rescale(dur, self.from, self.to)
                    };
                    if v1 {
                        put_u64(b, e, dur)?;
                    } else {
                        put_u32(b, e, u32::try_from(dur).ok()?)?;
                    }
                }
            }
            _ => {}
        }
        Some(())
    }
}

/// The source movie's timescale and duration (`mvhd`).
fn movie_header(src: &[u8], track: &Track) -> Option<(u32, u64)> {
    let kids = boxes(src, track.moov.body, track.moov.end)?;
    scale_and_duration(src, child(&kids, b"mvhd")?.body)
}

/// The track's presented length in timescale `to`: its own header's
/// when it says, else its samples' total.
fn shown_length(src: &[u8], track: &Track, from: u32, to: u32) -> Option<u64> {
    let kids = boxes(src, track.trak.body, track.trak.end)?;
    let tkhd = child(&kids, b"tkhd")?.body;
    let d = if *src.get(tkhd)? == 1 {
        u64_at(src, tkhd + 28)?
    } else {
        u64::from(u32_at(src, tkhd + 20)?)
    };
    Some(if d != 0 {
        rescale(d, from, to)
    } else {
        rescale(track.media_duration(), track.timescale, to)
    })
}

/// The picture (`video`) and the sound (`audio`), each a single-track
/// MP4, plain or fragmented, as one plain two-track MP4. None when
/// either isn't a file this understands.
pub fn mux(video: &[u8], audio: &[u8]) -> Option<Vec<u8>> {
    let tracks = [read_track(video)?, read_track(audio)?];
    let srcs = [video, audio];
    let (movie_scale, _) = movie_header(video, &tracks[0])?;
    let mut retracks = Vec::with_capacity(2);
    for (k, (src, track)) in srcs.iter().zip(&tracks).enumerate() {
        let (from, _) = movie_header(src, track)?;
        retracks.push(Retrack {
            id: k as u32 + 1,
            from,
            to: movie_scale,
            media: track.media_duration(),
            media_scale: track.timescale,
            shown: shown_length(src, track, from, movie_scale)?,
        });
    }
    let length = retracks.iter().map(|r| r.shown).max()?;

    // Chunks in time order across both tracks (picture first on a tie).
    let mut order: Vec<(f64, usize, usize)> = Vec::new();
    for (t, track) in tracks.iter().enumerate() {
        for (k, start) in track.run_starts().into_iter().enumerate() {
            order.push((start, t, k));
        }
    }
    order.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    let data: u64 = tracks
        .iter()
        .flat_map(|t| t.runs.iter().flatten())
        .map(|s| u64::from(s.size))
        .sum();

    let ftyp = ftyp();
    let mdat = mdat_header(data);
    let movie = |offsets: &[Vec<u64>; 2], wide: bool| -> Option<Vec<u8>> {
        let mut body = Vec::new();
        let kids = boxes(video, tracks[0].moov.body, tracks[0].moov.end)?;
        let mvhd = child(&kids, b"mvhd")?;
        let mut header = video[mvhd.start..mvhd.end].to_vec();
        let at = payload(&header);
        if header[at] == 1 {
            put_u64(&mut header, at + 24, length)?;
        } else {
            put_u32(&mut header, at + 16, u32::try_from(length).ok()?)?;
        }
        let last = header.len() - 4;
        put_u32(&mut header, last, 3)?;
        body.extend(header);
        for t in 0..2 {
            let layout = Layout {
                runs: &tracks[t].runs,
                offsets: &offsets[t],
                wide,
            };
            let re = &retracks[t];
            let mut patch = |kind: &[u8; 4], b: &mut [u8]| {
                let _ = re.patch(kind, b);
            };
            body.extend(rebuild(srcs[t], &tracks[t].trak, &layout, &mut patch)?);
        }
        Some(crate::fmp4::wrap(b"moov", &body))
    };

    // As in `defragment`: the moov's size depends only on the offsets'
    // width, so measure with zeros, then write with the real ones.
    let zeros = [vec![0; tracks[0].runs.len()], vec![0; tracks[1].runs.len()]];
    let fits = |moov: usize| ftyp.len() + moov + mdat.len() + data as usize <= u32::MAX as usize;
    let mut wide = false;
    let mut probe = movie(&zeros, wide)?;
    if !fits(probe.len()) {
        wide = true;
        probe = movie(&zeros, wide)?;
    }
    let mut at = (ftyp.len() + probe.len() + mdat.len()) as u64;
    let mut offsets = [vec![0; tracks[0].runs.len()], vec![0; tracks[1].runs.len()]];
    for &(_, t, k) in &order {
        offsets[t][k] = at;
        at += tracks[t].runs[k]
            .iter()
            .map(|s| u64::from(s.size))
            .sum::<u64>();
    }
    let moov = movie(&offsets, wide)?;

    let mut out = Vec::with_capacity(at as usize);
    out.extend(ftyp);
    out.extend(moov);
    out.extend(mdat);
    for &(_, t, k) in &order {
        for s in &tracks[t].runs[k] {
            out.extend_from_slice(&srcs[t][s.offset..s.offset + s.size as usize]);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fmp4::{defragment, is_fragmented, read_tracks};

    const VIDEO: &[u8] = include_bytes!("../tests/fixtures/clip-video.mp4");
    const AUDIO: &[u8] = include_bytes!("../tests/fixtures/clip-audio.m4a");
    const AUDIO_PLAIN: &[u8] = include_bytes!("../tests/fixtures/clip-audio-plain.m4a");

    /// A track's sample bytes, in decode order.
    fn payloads(src: &[u8], track: &Track) -> Vec<Vec<u8>> {
        track
            .runs
            .iter()
            .flatten()
            .map(|s| src[s.offset..s.offset + s.size as usize].to_vec())
            .collect()
    }

    /// One muxed track as read back: handler, track id, media
    /// timescale and duration, sample payloads.
    struct Read {
        handler: [u8; 4],
        id: u32,
        scale: u32,
        duration: u64,
        samples: Vec<Vec<u8>>,
    }

    /// The muxed file's tracks, and the movie's timescale and length.
    fn read_mux(out: &[u8]) -> (Vec<Read>, (u32, u64)) {
        let top = boxes(out, 0, out.len()).unwrap();
        let kinds: Vec<_> = top.iter().map(|b| b.kind).collect();
        assert_eq!(kinds, [*b"ftyp", *b"moov", *b"mdat"]);
        let moov = child(&top, b"moov").unwrap();
        let kids = boxes(out, moov.body, moov.end).unwrap();
        assert!(child(&kids, b"mvex").is_none());
        let movie = scale_and_duration(out, child(&kids, b"mvhd").unwrap().body).unwrap();
        let tracks = read_tracks(out)
            .unwrap()
            .into_iter()
            .map(|t| {
                let tk = boxes(out, t.trak.body, t.trak.end).unwrap();
                let tkhd = child(&tk, b"tkhd").unwrap().body;
                let mdia = child(&tk, b"mdia").unwrap();
                let md = boxes(out, mdia.body, mdia.end).unwrap();
                let hdlr = child(&md, b"hdlr").unwrap().body;
                let (scale, duration) =
                    scale_and_duration(out, child(&md, b"mdhd").unwrap().body).unwrap();
                Read {
                    handler: out[hdlr + 8..hdlr + 12].try_into().unwrap(),
                    id: u32_at(out, tkhd + 12).unwrap(),
                    scale,
                    duration,
                    samples: payloads(out, &t),
                }
            })
            .collect();
        (tracks, movie)
    }

    #[test]
    fn picture_and_sound_come_out_as_one_plain_two_track_file() {
        let out = mux(VIDEO, AUDIO).expect("muxes");
        assert!(!is_fragmented(&out));
        let (tracks, (movie_scale, movie_len)) = read_mux(&out);
        assert_eq!(tracks.len(), 2);
        let video = read_track(VIDEO).unwrap();
        let audio = read_track(AUDIO).unwrap();
        let (v, a) = (&tracks[0], &tracks[1]);
        assert_eq!((&v.handler, v.id), (b"vide", 1));
        assert_eq!((&a.handler, a.id), (b"soun", 2));
        // Every sample, byte for byte, in order.
        assert_eq!(v.samples, payloads(VIDEO, &video));
        assert_eq!(a.samples, payloads(AUDIO, &audio));
        // Durations filled in from the samples (ffmpeg's fragmented
        // files leave them at zero): 2 s of picture, ~2.32 s of sound.
        assert_eq!(v.scale, video.timescale);
        assert_eq!(a.scale, 44_100);
        assert!((v.duration as f64 / f64::from(v.scale) - 2.0).abs() < 0.01);
        assert!((a.duration as f64 / f64::from(a.scale) - 2.32).abs() < 0.01);
        // The movie lasts as long as its longer track.
        let secs = movie_len as f64 / movie_scale as f64;
        assert!((secs - 2.32).abs() < 0.01, "movie {secs} s");
    }

    #[test]
    fn chunks_interleave_by_time() {
        let out = mux(VIDEO, AUDIO).unwrap();
        let (tracks, _) = read_mux(&out);
        // Where each track's first and last bytes sit in the file: the
        // sound's first chunk lands before the picture's last.
        let find = |needle: &[u8]| out.windows(needle.len()).position(|w| w == needle).unwrap();
        let video_last = find(tracks[0].samples.last().unwrap());
        let audio_first = find(&tracks[1].samples[0]);
        assert!(audio_first < video_last);
    }

    #[test]
    fn the_sound_decodes_from_the_muxed_file_as_from_its_own() {
        use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_AAC, CODEC_TYPE_NULL};
        use symphonia::core::formats::FormatOptions;
        use symphonia::core::io::MediaSourceStream;
        use symphonia::core::meta::MetadataOptions;
        use symphonia::core::probe::Hint;

        /// (tracks, AAC frames decoded, PCM frames out).
        fn decode(bytes: Vec<u8>) -> (usize, usize, u64) {
            let stream =
                MediaSourceStream::new(Box::new(std::io::Cursor::new(bytes)), Default::default());
            let mut format = symphonia::default::get_probe()
                .format(
                    Hint::new().with_extension("mp4"),
                    stream,
                    &FormatOptions::default(),
                    &MetadataOptions::default(),
                )
                .unwrap()
                .format;
            let tracks = format.tracks().len();
            let track = format
                .tracks()
                .iter()
                .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
                .unwrap()
                .clone();
            assert_eq!(track.codec_params.codec, CODEC_TYPE_AAC);
            let mut decoder = symphonia::default::get_codecs()
                .make(&track.codec_params, &DecoderOptions::default())
                .unwrap();
            let (mut packets, mut frames) = (0, 0u64);
            while let Ok(packet) = format.next_packet() {
                if packet.track_id() != track.id {
                    continue;
                }
                let buf = decoder.decode(&packet).expect("decodes");
                packets += 1;
                frames += buf.frames() as u64;
            }
            (tracks, packets, frames)
        }
        let alone = decode(defragment(AUDIO).unwrap());
        let muxed = decode(mux(VIDEO, AUDIO).unwrap());
        assert_eq!(alone.0, 1);
        assert_eq!(muxed.0, 2);
        assert!(alone.1 > 90);
        assert_eq!((muxed.1, muxed.2), (alone.1, alone.2));
    }

    #[test]
    fn a_plain_sound_file_with_an_edit_list_muxes_too() {
        let out = mux(VIDEO, AUDIO_PLAIN).expect("muxes");
        let (tracks, (scale, len)) = read_mux(&out);
        let audio = read_track(AUDIO_PLAIN).unwrap();
        assert_eq!(tracks[1].samples, payloads(AUDIO_PLAIN, &audio));
        // ffmpeg's edit list skips the encoder's 1024-sample priming:
        // 2.3 s shown, and the movie's timescale counts it.
        let secs = len as f64 / scale as f64;
        assert!((secs - 2.3).abs() < 0.01, "movie {secs} s");
        let trak = read_tracks(&out).unwrap()[1].trak;
        let edts = *child(&boxes(&out, trak.body, trak.end).unwrap(), b"edts").unwrap();
        let elst = *child(&boxes(&out, edts.body, edts.end).unwrap(), b"elst").unwrap();
        let (dur, time) = (
            u32_at(&out, elst.body + 8).unwrap(),
            u32_at(&out, elst.body + 12).unwrap(),
        );
        assert_eq!(time, 1024);
        assert!((f64::from(dur) / f64::from(scale) - 2.3).abs() < 0.01);
    }

    #[test]
    fn a_picture_already_made_plain_muxes_the_same() {
        // The cache keeps pictures defragmented (`fmp4`): the muxed
        // file is the same either way.
        let plain = defragment(VIDEO).unwrap();
        assert_eq!(mux(&plain, AUDIO).unwrap(), mux(VIDEO, AUDIO).unwrap());
    }

    #[test]
    fn broken_input_is_refused() {
        assert!(mux(VIDEO, b"not an mp4").is_none());
        assert!(mux(&VIDEO[..VIDEO.len() - 9], AUDIO).is_none());
    }
}
