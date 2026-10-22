//! A track's loudness over time, for lining captions up with the
//! audio they transcribe: one byte per 20 ms frame (RMS level in
//! dB + 100, clamped to 0-100). HE-AAC (YouTube's 48 kbps tracks)
//! decodes as its AAC-LC core at half rate, which is plenty to tell
//! speech from a pause.

use std::path::Path;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::Result;

/// Frames per second in an envelope.
pub const FPS: u32 = 50;

/// One frame's level byte from its mean square.
fn level(mean_square: f64) -> u8 {
    let db = 10.0 * mean_square.max(1e-10).log10();
    (db + 100.0).round().clamp(0.0, 100.0) as u8
}

/// The loudness envelope of the audio file at `path`.
pub fn envelope(path: &Path) -> Result<Vec<u8>> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("listen-envelope: {e}"))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or("listen-envelope: no track")?
        .clone();
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("listen-envelope: {e}"))?;
    let mut out = Vec::new();
    let mut sum = 0.0f64;
    let mut count = 0usize;
    let mut per_frame = 0usize;
    let mut samples: Option<SampleBuffer<f32>> = None;
    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track.id {
            continue;
        }
        // A damaged packet skips; the rest of the track still counts.
        let Ok(decoded) = decoder.decode(&packet) else {
            continue;
        };
        let spec = *decoded.spec();
        let channels = spec.channels.count().max(1);
        if per_frame == 0 {
            per_frame = (spec.rate / FPS) as usize * channels;
        }
        let buf = samples.get_or_insert_with(|| SampleBuffer::new(decoded.capacity() as u64, spec));
        if buf.capacity() < decoded.capacity() {
            *buf = SampleBuffer::new(decoded.capacity() as u64, spec);
        }
        buf.copy_interleaved_ref(decoded);
        for &s in buf.samples() {
            sum += f64::from(s) * f64::from(s);
            count += 1;
            if count >= per_frame {
                out.push(level(sum / count as f64));
                sum = 0.0;
                count = 0;
            }
        }
    }
    if count > 0 {
        out.push(level(sum / count as f64));
    }
    if out.is_empty() {
        return Err("listen-envelope: no audio".into());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_span_silence_to_full_scale() {
        assert_eq!(level(0.0), 0);
        assert_eq!(level(1.0), 100);
        // A -20 dB tone's mean square is 0.01.
        assert_eq!(level(0.01), 80);
    }

    #[test]
    fn a_missing_file_is_an_error() {
        assert!(envelope(Path::new("/nonexistent/audio.m4a")).is_err());
    }
}
