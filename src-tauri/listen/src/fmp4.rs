//! YouTube's picture tracks are fragmented MP4 (DASH: an empty sample
//! table in `moov`, the samples in `moof`/`mdat` pairs). Chromium seeks
//! those cleanly, but the drill seeks a fresh `<video>` into the middle
//! of the file for every clip after the first, and the Mac's player
//! showed smeared frames from there on. A plain MP4 with its full
//! sample table up front (`stss` naming every keyframe) leaves no
//! player guessing where a seek can start decoding. Pure byte work:
//! the sample data is copied, never re-encoded.

/// One box: its type and where it sits in the parent slice.
#[derive(Clone, Copy)]
pub(crate) struct Box4 {
    pub(crate) kind: [u8; 4],
    /// Offset of the box's first byte.
    pub(crate) start: usize,
    /// Offset of the payload (after the size/type header).
    pub(crate) body: usize,
    /// Offset one past the box's last byte.
    pub(crate) end: usize,
}

pub(crate) fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

pub(crate) fn u64_at(b: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_be_bytes(b.get(at..at + 8)?.try_into().ok()?))
}

/// The boxes laid end to end in `b[from..to]`; None on a malformed size.
pub(crate) fn boxes(b: &[u8], from: usize, to: usize) -> Option<Vec<Box4>> {
    let mut out = Vec::new();
    let mut at = from;
    while at + 8 <= to {
        let size32 = u32_at(b, at)? as usize;
        let kind: [u8; 4] = b.get(at + 4..at + 8)?.try_into().ok()?;
        let (size, header) = match size32 {
            0 => (to - at, 8),
            1 => (usize::try_from(u64_at(b, at + 8)?).ok()?, 16),
            n => (n, 8),
        };
        if size < header || at + size > to {
            return None;
        }
        out.push(Box4 {
            kind,
            start: at,
            body: at + header,
            end: at + size,
        });
        at += size;
    }
    Some(out)
}

pub(crate) fn child<'a>(list: &'a [Box4], kind: &[u8; 4]) -> Option<&'a Box4> {
    list.iter().find(|x| &x.kind == kind)
}

pub(crate) fn wrap(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len() + 8);
    out.extend_from_slice(&((body.len() + 8) as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(body);
    out
}

/// A full box (version + flags) from its payload words.
fn full(kind: &[u8; 4], version: u8, words: &[u32]) -> Vec<u8> {
    let mut body = Vec::with_capacity(4 + words.len() * 4);
    body.extend_from_slice(&(u32::from(version) << 24).to_be_bytes());
    for w in words {
        body.extend_from_slice(&w.to_be_bytes());
    }
    wrap(kind, &body)
}

/// True when `moov` announces fragments (`mvex`): the file needs
/// `defragment` before a player can see its whole sample table.
pub fn is_fragmented(src: &[u8]) -> bool {
    let Some(top) = boxes(src, 0, src.len()) else {
        return false;
    };
    let Some(moov) = child(&top, b"moov") else {
        return false;
    };
    boxes(src, moov.body, moov.end).is_some_and(|kids| child(&kids, b"mvex").is_some())
}

pub(crate) struct Sample {
    /// Absolute offset of the sample's bytes in the source.
    pub(crate) offset: usize,
    pub(crate) size: u32,
    pub(crate) duration: u32,
    sync: bool,
    cto: i32,
}

/// Track defaults from `trex`: duration, size, flags.
#[derive(Clone, Copy, Default)]
struct Defaults {
    duration: u32,
    size: u32,
    flags: u32,
}

/// `sample_is_non_sync_sample` in ISO sample flags.
const NON_SYNC: u32 = 0x0001_0000;

/// Every sample of `track` across the file's fragments, in decode
/// order, grouped into runs (one run = one contiguous chunk).
fn fragment_samples(
    src: &[u8],
    top: &[Box4],
    track: u32,
    trex: Defaults,
) -> Option<Vec<Vec<Sample>>> {
    let mut runs = Vec::new();
    for moof in top.iter().filter(|x| &x.kind == b"moof") {
        for traf in boxes(src, moof.body, moof.end)?
            .iter()
            .filter(|x| &x.kind == b"traf")
        {
            let kids = boxes(src, traf.body, traf.end)?;
            let tfhd = child(&kids, b"tfhd")?;
            let flags = u32_at(src, tfhd.body)? & 0x00ff_ffff;
            if u32_at(src, tfhd.body + 4)? != track {
                continue;
            }
            let mut at = tfhd.body + 8;
            let mut base = moof.start;
            if flags & 0x1 != 0 {
                base = usize::try_from(u64_at(src, at)?).ok()?;
                at += 8;
            }
            if flags & 0x2 != 0 {
                at += 4;
            }
            let mut d = trex;
            if flags & 0x8 != 0 {
                d.duration = u32_at(src, at)?;
                at += 4;
            }
            if flags & 0x10 != 0 {
                d.size = u32_at(src, at)?;
                at += 4;
            }
            if flags & 0x20 != 0 {
                d.flags = u32_at(src, at)?;
            }
            let mut next = base;
            for trun in kids.iter().filter(|x| &x.kind == b"trun") {
                let head = u32_at(src, trun.body)?;
                let (version, tf) = (head >> 24, head & 0x00ff_ffff);
                let count = u32_at(src, trun.body + 4)? as usize;
                let mut at = trun.body + 8;
                let mut offset = next;
                if tf & 0x1 != 0 {
                    let rel = u32_at(src, at)? as i32;
                    offset = usize::try_from(base as i64 + i64::from(rel)).ok()?;
                    at += 4;
                }
                let mut first_flags = None;
                if tf & 0x4 != 0 {
                    first_flags = Some(u32_at(src, at)?);
                    at += 4;
                }
                let mut run = Vec::with_capacity(count);
                for i in 0..count {
                    let mut take = |on: u32| -> Option<Option<u32>> {
                        if tf & on == 0 {
                            return Some(None);
                        }
                        let v = u32_at(src, at)?;
                        at += 4;
                        Some(Some(v))
                    };
                    let duration = take(0x100)?.unwrap_or(d.duration);
                    let size = take(0x200)?.unwrap_or(d.size);
                    let own_flags = take(0x400)?;
                    let cto = take(0x800)?.map_or(0, |v| {
                        if version == 0 {
                            // Unsigned in version 0; keep it in range.
                            i32::try_from(v).unwrap_or(i32::MAX)
                        } else {
                            v as i32
                        }
                    });
                    let sample_flags = match (i, first_flags, own_flags) {
                        (0, Some(f), _) => f,
                        (_, _, Some(f)) => f,
                        _ => d.flags,
                    };
                    if offset + size as usize > src.len() {
                        return None;
                    }
                    run.push(Sample {
                        offset,
                        size,
                        duration,
                        sync: sample_flags & NON_SYNC == 0,
                        cto,
                    });
                    offset += size as usize;
                }
                next = offset;
                if !run.is_empty() {
                    runs.push(run);
                }
            }
        }
    }
    Some(runs)
}

/// Run-length pairs of consecutive equal values.
fn runs_of<T: PartialEq + Copy>(values: impl Iterator<Item = T>) -> Vec<(u32, T)> {
    let mut out: Vec<(u32, T)> = Vec::new();
    for v in values {
        match out.last_mut() {
            Some((n, last)) if *last == v => *n += 1,
            _ => out.push((1, v)),
        }
    }
    out
}

/// The new sample table: `stsd` (and anything else not rebuilt) kept,
/// the rest from `runs`, one chunk per run, run `k` at `offsets[k]`.
fn sample_table(
    src: &[u8],
    stbl: &Box4,
    runs: &[Vec<Sample>],
    offsets: &[u64],
    wide: bool,
) -> Option<Vec<u8>> {
    const REBUILT: [&[u8; 4]; 7] = [
        b"stts", b"ctts", b"stss", b"stsc", b"stsz", b"stco", b"co64",
    ];
    let mut body = Vec::new();
    for kid in boxes(src, stbl.body, stbl.end)? {
        if !REBUILT.contains(&&kid.kind) {
            body.extend_from_slice(&src[kid.start..kid.end]);
        }
    }
    let all = || runs.iter().flatten();
    let count = all().count() as u32;

    let stts = runs_of(all().map(|s| s.duration));
    let mut words = vec![stts.len() as u32];
    words.extend(stts.iter().flat_map(|&(n, d)| [n, d]));
    body.extend(full(b"stts", 0, &words));

    if all().any(|s| s.cto != 0) {
        let signed = all().any(|s| s.cto < 0);
        let ctts = runs_of(all().map(|s| s.cto));
        let mut words = vec![ctts.len() as u32];
        words.extend(ctts.iter().flat_map(|&(n, c)| [n, c as u32]));
        body.extend(full(b"ctts", u8::from(signed), &words));
    }

    // No stss means every sample is a keyframe; otherwise name them.
    if all().any(|s| !s.sync) {
        let keys: Vec<u32> = all()
            .enumerate()
            .filter(|(_, s)| s.sync)
            .map(|(i, _)| i as u32 + 1)
            .collect();
        let mut words = vec![keys.len() as u32];
        words.extend(keys);
        body.extend(full(b"stss", 0, &words));
    }

    let per_chunk = runs_of(runs.iter().map(|r| r.len() as u32));
    let mut words = vec![per_chunk.len() as u32];
    let mut chunk = 1;
    for (n, samples) in per_chunk {
        words.extend([chunk, samples, 1]);
        chunk += n;
    }
    body.extend(full(b"stsc", 0, &words));

    let mut words = vec![0, count];
    words.extend(all().map(|s| s.size));
    body.extend(full(b"stsz", 0, &words));

    if offsets.len() != runs.len() {
        return None;
    }
    if wide {
        let mut b = (0u32).to_be_bytes().to_vec();
        b.extend((offsets.len() as u32).to_be_bytes());
        for o in offsets {
            b.extend(o.to_be_bytes());
        }
        body.extend(wrap(b"co64", &b));
    } else {
        let mut words = vec![offsets.len() as u32];
        words.extend(offsets.iter().map(|&o| o as u32));
        body.extend(full(b"stco", 0, &words));
    }
    Some(wrap(b"stbl", &body))
}

/// Where a rebuilt track's samples land: one chunk per run, run `k`
/// at `offsets[k]`, in 64-bit offsets when `wide`.
pub(crate) struct Layout<'a> {
    pub(crate) runs: &'a [Vec<Sample>],
    pub(crate) offsets: &'a [u64],
    pub(crate) wide: bool,
}

/// `b` rebuilt for a plain file: `mvex` dropped, the `stbl` from
/// `layout`, and every other box copied, each leaf through `patch`
/// (which may rewrite its bytes in place: the box and its header).
pub(crate) fn rebuild(
    src: &[u8],
    b: &Box4,
    layout: &Layout,
    patch: &mut dyn FnMut(&[u8; 4], &mut [u8]),
) -> Option<Vec<u8>> {
    let mut body = Vec::new();
    for kid in boxes(src, b.body, b.end)? {
        match &kid.kind {
            b"mvex" => {}
            b"trak" | b"mdia" | b"minf" | b"edts" => {
                body.extend(rebuild(src, &kid, layout, patch)?)
            }
            b"stbl" => body.extend(sample_table(
                src,
                &kid,
                layout.runs,
                layout.offsets,
                layout.wide,
            )?),
            _ => {
                let mut bytes = src[kid.start..kid.end].to_vec();
                patch(&kid.kind, &mut bytes);
                body.extend(bytes);
            }
        }
    }
    Some(wrap(&b.kind, &body))
}

/// Chunk offsets for runs laid end to end from `base`.
fn packed(runs: &[Vec<Sample>], base: u64) -> Vec<u64> {
    let mut at = base;
    runs.iter()
        .map(|run| {
            let o = at;
            at += run.iter().map(|s| u64::from(s.size)).sum::<u64>();
            o
        })
        .collect()
}

/// The `ftyp` every rebuilt file starts with.
pub(crate) fn ftyp() -> Vec<u8> {
    let mut body = Vec::new();
    body.extend_from_slice(b"isom");
    body.extend(512u32.to_be_bytes());
    for brand in [b"isom", b"iso2", b"avc1", b"mp41"] {
        body.extend_from_slice(brand);
    }
    wrap(b"ftyp", &body)
}

/// An `mdat` header for `data` bytes of samples.
pub(crate) fn mdat_header(data: u64) -> Vec<u8> {
    let mut out = Vec::new();
    if data + 8 > u64::from(u32::MAX) {
        out.extend(1u32.to_be_bytes());
        out.extend_from_slice(b"mdat");
        out.extend((data + 16).to_be_bytes());
    } else {
        out.extend(((data + 8) as u32).to_be_bytes());
        out.extend_from_slice(b"mdat");
    }
    out
}

/// The one track of a single-track MP4, plain or fragmented: its
/// boxes and its samples in decode order, grouped into runs.
pub(crate) struct Track {
    pub(crate) moov: Box4,
    pub(crate) trak: Box4,
    pub(crate) runs: Vec<Vec<Sample>>,
    /// The media timescale (`mdhd`).
    pub(crate) timescale: u32,
}

impl Track {
    /// Seconds from the track's start to run `k`'s first sample.
    pub(crate) fn run_starts(&self) -> Vec<f64> {
        let mut t = 0u64;
        self.runs
            .iter()
            .map(|run| {
                let at = t;
                t += run.iter().map(|s| u64::from(s.duration)).sum::<u64>();
                at as f64 / f64::from(self.timescale.max(1))
            })
            .collect()
    }

    /// The track's length in its own timescale (the sum of its
    /// sample durations).
    pub(crate) fn media_duration(&self) -> u64 {
        self.runs
            .iter()
            .flatten()
            .map(|s| u64::from(s.duration))
            .sum()
    }
}

/// Timescale and duration of an `mvhd` or `mdhd` (same layout up to
/// there), from its payload offset.
pub(crate) fn scale_and_duration(b: &[u8], body: usize) -> Option<(u32, u64)> {
    if *b.get(body)? == 1 {
        Some((u32_at(b, body + 20)?, u64_at(b, body + 24)?))
    } else {
        Some((u32_at(b, body + 12)?, u64::from(u32_at(b, body + 16)?)))
    }
}

/// Every track of `src`, plain or fragmented.
pub(crate) fn read_tracks(src: &[u8]) -> Option<Vec<Track>> {
    let top = boxes(src, 0, src.len())?;
    let moov = *child(&top, b"moov")?;
    let kids = boxes(src, moov.body, moov.end)?;
    let mut out = Vec::new();
    for trak in kids.iter().filter(|x| &x.kind == b"trak") {
        let trak = *trak;
        let trak_kids = boxes(src, trak.body, trak.end)?;
        let mdia = child(&trak_kids, b"mdia")?;
        let mdia_kids = boxes(src, mdia.body, mdia.end)?;
        let (timescale, _) = scale_and_duration(src, child(&mdia_kids, b"mdhd")?.body)?;
        let runs = match child(&kids, b"mvex") {
            Some(mvex) => {
                let tkhd = child(&trak_kids, b"tkhd")?.body;
                let track = if src.get(tkhd)? == &1 {
                    u32_at(src, tkhd + 4 + 16)?
                } else {
                    u32_at(src, tkhd + 4 + 8)?
                };
                let mut trex = Defaults::default();
                for x in boxes(src, mvex.body, mvex.end)? {
                    if &x.kind == b"trex" && u32_at(src, x.body + 4)? == track {
                        trex = Defaults {
                            duration: u32_at(src, x.body + 12)?,
                            size: u32_at(src, x.body + 16)?,
                            flags: u32_at(src, x.body + 20)?,
                        };
                    }
                }
                fragment_samples(src, &top, track, trex)?
            }
            None => {
                let minf = child(&mdia_kids, b"minf")?;
                let stbl = *child(&boxes(src, minf.body, minf.end)?, b"stbl")?;
                plain_samples(src, &stbl)?
            }
        };
        if runs.is_empty() {
            return None;
        }
        out.push(Track {
            moov,
            trak,
            runs,
            timescale,
        });
    }
    Some(out)
}

/// The one track of a single-track `src`.
pub(crate) fn read_track(src: &[u8]) -> Option<Track> {
    let mut tracks = read_tracks(src)?;
    if tracks.len() != 1 {
        return None;
    }
    tracks.pop()
}

/// A full box's entry words: count at `body + 4`, then `width` words
/// per entry. None when the box is shorter than it says.
fn entries(src: &[u8], b: &Box4, width: usize) -> Option<Vec<u32>> {
    let count = u32_at(src, b.body + 4)? as usize;
    let from = b.body + 8;
    if count.checked_mul(width * 4)? > b.end.saturating_sub(from) {
        return None;
    }
    (0..count * width)
        .map(|k| u32_at(src, from + k * 4))
        .collect()
}

/// The samples a plain file's sample table describes, one run per
/// chunk.
fn plain_samples(src: &[u8], stbl: &Box4) -> Option<Vec<Vec<Sample>>> {
    let kids = boxes(src, stbl.body, stbl.end)?;
    let stsz = child(&kids, b"stsz")?;
    let fixed = u32_at(src, stsz.body + 4)?;
    let count = u32_at(src, stsz.body + 8)? as usize;
    // Every sample takes at least a byte of the file.
    if count > src.len() {
        return None;
    }
    let sizes: Vec<u32> = if fixed != 0 {
        vec![fixed; count]
    } else {
        if count * 4 > stsz.end.saturating_sub(stsz.body + 12) {
            return None;
        }
        (0..count)
            .map(|k| u32_at(src, stsz.body + 12 + k * 4))
            .collect::<Option<_>>()?
    };
    // Expand run-length (count, value) pairs to one value per sample.
    let expand = |words: &[u32]| -> Vec<u32> {
        let mut out = Vec::with_capacity(count);
        for pair in words.chunks_exact(2) {
            let room = count - out.len();
            out.extend(std::iter::repeat_n(pair[1], (pair[0] as usize).min(room)));
        }
        out
    };
    let durations = expand(&entries(src, child(&kids, b"stts")?, 2)?);
    let ctts = match child(&kids, b"ctts") {
        Some(b) => {
            let signed = src.get(b.body) == Some(&1);
            expand(&entries(src, b, 2)?)
                .into_iter()
                .map(|v| {
                    if signed {
                        v as i32
                    } else {
                        i32::try_from(v).unwrap_or(i32::MAX)
                    }
                })
                .collect()
        }
        None => Vec::new(),
    };
    let keys = match child(&kids, b"stss") {
        Some(b) => Some(entries(src, b, 1)?),
        None => None,
    };
    let offsets: Vec<u64> = if let Some(b) = child(&kids, b"stco") {
        entries(src, b, 1)?.into_iter().map(u64::from).collect()
    } else {
        let b = child(&kids, b"co64")?;
        entries(src, b, 2)?
            .chunks_exact(2)
            .map(|w| u64::from(w[0]) << 32 | u64::from(w[1]))
            .collect()
    };
    let stsc = entries(src, child(&kids, b"stsc")?, 3)?;
    let mut runs = Vec::with_capacity(offsets.len());
    let mut next = 0usize;
    for (c, &offset) in offsets.iter().enumerate() {
        let chunk = c as u32 + 1;
        let per = stsc
            .chunks_exact(3)
            .take_while(|e| e[0] <= chunk)
            .last()
            .map_or(0, |e| e[1]) as usize;
        let mut at = usize::try_from(offset).ok()?;
        let mut run = Vec::with_capacity(per.min(count));
        let end = (next + per).min(count);
        for (k, &size) in sizes.iter().enumerate().take(end).skip(next) {
            if at.checked_add(size as usize)? > src.len() {
                return None;
            }
            run.push(Sample {
                offset: at,
                size,
                duration: *durations.get(k).unwrap_or(&0),
                sync: keys
                    .as_ref()
                    .is_none_or(|keys| keys.binary_search(&(k as u32 + 1)).is_ok()),
                cto: *ctts.get(k).unwrap_or(&0),
            });
            at += size as usize;
        }
        next += run.len();
        if !run.is_empty() {
            runs.push(run);
        }
    }
    (next == count).then_some(runs)
}

/// A fragmented single-track MP4 as a plain one: `ftyp`, `moov` with
/// the whole sample table, then one `mdat`. None when the input isn't
/// a single-track fragmented file this understands; callers keep the
/// original then.
pub fn defragment(src: &[u8]) -> Option<Vec<u8>> {
    if !is_fragmented(src) {
        return None;
    }
    let track = read_track(src)?;
    let runs = &track.runs;
    let data: u64 = runs.iter().flatten().map(|s| u64::from(s.size)).sum();
    let ftyp = ftyp();
    let mdat = mdat_header(data);
    let movie = |offsets: &[u64], wide: bool| {
        let layout = Layout {
            runs,
            offsets,
            wide,
        };
        rebuild(src, &track.moov, &layout, &mut |_, _| {})
    };

    // The moov's size doesn't depend on the offsets inside it, only on
    // their width: measure once, then write with the real base.
    let zeros = vec![0; runs.len()];
    let fits = |moov: usize| ftyp.len() + moov + mdat.len() + data as usize <= u32::MAX as usize;
    let mut wide = false;
    let mut probe = movie(&zeros, wide)?;
    if !fits(probe.len()) {
        wide = true;
        probe = movie(&zeros, wide)?;
    }
    let base = (ftyp.len() + probe.len() + mdat.len()) as u64;
    let moov_out = movie(&packed(runs, base), wide)?;

    let mut out = Vec::with_capacity(base as usize + data as usize);
    out.extend(ftyp);
    out.extend(moov_out);
    out.extend(mdat);
    for s in runs.iter().flatten() {
        out.extend_from_slice(&src[s.offset..s.offset + s.size as usize]);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bx(kind: &[u8; 4], parts: &[&[u8]]) -> Vec<u8> {
        wrap(kind, &parts.concat())
    }

    fn be(words: &[u32]) -> Vec<u8> {
        words.iter().flat_map(|w| w.to_be_bytes()).collect()
    }

    /// Two fragments of a one-track file: four samples each, the
    /// first of each fragment a keyframe (YouTube's shape: sizes,
    /// flags and composition offsets per sample, duration in tfhd).
    fn fragmented() -> (Vec<u8>, Vec<Vec<u8>>) {
        let stsd = bx(b"stsd", &[&be(&[0, 0])]);
        let empty = |k: &[u8; 4]| bx(k, &[&be(&[0, 0])]);
        let stbl = bx(
            b"stbl",
            &[
                &stsd,
                &empty(b"stts"),
                &empty(b"stsc"),
                &empty(b"stco"),
                &bx(b"stsz", &[&be(&[0, 0, 0])]),
                &empty(b"stss"),
            ],
        );
        let minf = bx(b"minf", &[&stbl]);
        let mdia = bx(b"mdia", &[&bx(b"mdhd", &[&be(&[0; 6])]), &minf]);
        let mut tkhd = be(&[3, 0, 0, 1]);
        tkhd.extend(vec![0; 76]);
        let trak = bx(b"trak", &[&bx(b"tkhd", &[&tkhd]), &mdia]);
        let mvex = bx(b"mvex", &[&bx(b"trex", &[&be(&[0, 1, 1, 0, 0, 0])])]);
        let moov = bx(b"moov", &[&bx(b"mvhd", &[&be(&[0; 25])]), &mvex, &trak]);
        let mut file = bx(b"ftyp", &[b"dash", &be(&[0])]);
        file.extend(&moov);
        let mut payloads = Vec::new();
        for frag in 0..2u8 {
            let samples: Vec<Vec<u8>> = (0..4u8)
                .map(|i| vec![frag * 16 + i; 3 + i as usize])
                .collect();
            let mut trun_body = be(&[0x0000_0e01, 4, 0]);
            for (i, s) in samples.iter().enumerate() {
                let flags = if i == 0 { 0x0200_0000 } else { 0x0101_0000 };
                trun_body.extend(be(&[s.len() as u32, flags, 512]));
            }
            let trun = bx(b"trun", &[&trun_body]);
            let tfhd = bx(b"tfhd", &[&be(&[0x0002_0008, 1, 512])]);
            let traf = bx(b"traf", &[&tfhd, &bx(b"tfdt", &[&be(&[0, 0])]), &trun]);
            let mut moof = bx(b"moof", &[&bx(b"mfhd", &[&be(&[0, 1])]), &traf]);
            // Patch the run's data offset: past the moof and mdat header.
            let off = moof.len() as u32 + 8;
            let at = moof.len() - trun_body.len() + 8;
            moof[at..at + 4].copy_from_slice(&off.to_be_bytes());
            file.extend(&moof);
            file.extend(bx(b"mdat", &[&samples.concat()]));
            payloads.extend(samples);
        }
        (file, payloads)
    }

    /// A box's payload by its path under `moov`'s track.
    fn table<'a>(out: &'a [u8], kind: &[u8; 4]) -> Option<&'a [u8]> {
        let (mut from, mut to) = (0, out.len());
        for k in [b"moov", b"trak", b"mdia", b"minf", b"stbl", kind] {
            let list = boxes(out, from, to)?;
            let b = child(&list, k)?;
            (from, to) = (b.body, b.end);
        }
        Some(&out[from..to])
    }

    #[test]
    fn a_fragmented_track_comes_out_plain_with_its_keyframes_named() {
        let (src, payloads) = fragmented();
        assert!(is_fragmented(&src));
        let out = defragment(&src).expect("defragments");
        assert!(!is_fragmented(&out));
        let top = boxes(&out, 0, out.len()).unwrap();
        let kinds: Vec<_> = top.iter().map(|b| b.kind).collect();
        assert_eq!(kinds, [*b"ftyp", *b"moov", *b"mdat"]);
        // Samples 1 and 5 are the keyframes.
        assert_eq!(table(&out, b"stss").unwrap(), be(&[0, 2, 1, 5]).as_slice());
        // Eight samples at the tfhd's default duration.
        assert_eq!(
            table(&out, b"stts").unwrap(),
            be(&[0, 1, 8, 512]).as_slice()
        );
        assert_eq!(
            table(&out, b"ctts").unwrap(),
            be(&[0, 1, 8, 512]).as_slice()
        );
        // One chunk per fragment run, four samples each.
        assert_eq!(
            table(&out, b"stsc").unwrap(),
            be(&[0, 1, 1, 4, 1]).as_slice()
        );
        // The chunk offsets point at the copied bytes, in order.
        let stco = table(&out, b"stco").unwrap();
        let first = u32_at(stco, 8).unwrap() as usize;
        let second = u32_at(stco, 12).unwrap() as usize;
        assert_eq!(&out[first..first + 3], payloads[0].as_slice());
        assert_eq!(&out[second..second + 3], payloads[4].as_slice());
        let mdat = top.last().unwrap();
        assert_eq!(&out[mdat.body..mdat.end], payloads.concat().as_slice());
    }

    #[test]
    fn plain_or_broken_input_is_left_alone() {
        let (src, _) = fragmented();
        let plain = defragment(&src).unwrap();
        assert!(defragment(&plain).is_none());
        assert!(defragment(&src[..src.len() - 5]).is_none());
        assert!(defragment(b"not an mp4").is_none());
    }
}
