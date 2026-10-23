//! What a speech recognizer heard in a track, word by word, for timing
//! the captions against the audio. The track goes to the recognizer in
//! pieces of about 45 s, cut at the quietest moment near each mark so
//! no word is split; each piece is recognized and cached on its own,
//! so the first clips get their times while the rest is still heard.

use serde::{Deserialize, Serialize};

/// One recognized word (or a few, as the recognizer groups them),
/// in seconds into the track.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HeardWord {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

/// One recognized piece of the track.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeardChunk {
    pub words: Vec<HeardWord>,
    /// The piece's span, seconds.
    pub start: f64,
    pub end: f64,
    /// How many pieces the track has.
    pub chunks: usize,
}

/// A piece aims for this length (s) …
const CHUNK_SEC: f64 = 45.0;
/// … and cuts this far either side of it at the quietest moment.
const SLACK_SEC: f64 = 8.0;
/// Quiet is judged over this many envelope frames (100 ms at 50 fps).
const QUIET_FRAMES: usize = 5;

/// The track's pieces, `(start, end)` in seconds, from its loudness
/// envelope (`fps` frames per second). Each cut sits at the quietest
/// stretch within `SLACK_SEC` of `CHUNK_SEC` after the one before.
pub fn chunk_bounds(env: &[u8], fps: u32) -> Vec<(f64, f64)> {
    let fps_f = f64::from(fps);
    let total = env.len();
    let target = (CHUNK_SEC * fps_f) as usize;
    let slack = (SLACK_SEC * fps_f) as usize;
    let mut out = Vec::new();
    let mut from = 0usize;
    while total - from > target + slack {
        let lo = from + target - slack;
        let hi = (from + target + slack).min(total - QUIET_FRAMES);
        let loudness =
            |k: usize| -> u32 { env[k..k + QUIET_FRAMES].iter().map(|&v| u32::from(v)).sum() };
        // The quietest window; its middle frame is the cut.
        let at = (lo..=hi).min_by_key(|&k| loudness(k)).unwrap_or(lo) + QUIET_FRAMES / 2;
        out.push((from as f64 / fps_f, at as f64 / fps_f));
        from = at;
    }
    if total > from {
        out.push((from as f64 / fps_f, total as f64 / fps_f));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_track_is_one_piece() {
        let env = vec![60u8; 50 * 30];
        assert_eq!(chunk_bounds(&env, 50), vec![(0.0, 30.0)]);
        assert!(chunk_bounds(&[], 50).is_empty());
    }

    #[test]
    fn pieces_cut_in_the_quiet_near_each_mark() {
        // Two minutes of speech with a pause at 41 s and one at 90 s.
        let mut env = vec![70u8; 50 * 120];
        for v in &mut env[50 * 41..50 * 41 + 20] {
            *v = 10;
        }
        for v in &mut env[50 * 90..50 * 90 + 20] {
            *v = 10;
        }
        let bounds = chunk_bounds(&env, 50);
        assert_eq!(bounds.len(), 3);
        let (_, first) = bounds[0];
        assert!((41.0..41.4).contains(&first), "{first}");
        let (start, second) = bounds[1];
        assert_eq!(start, first);
        assert!((90.0..90.4).contains(&second), "{second}");
        assert_eq!(bounds[2].1, 120.0);
    }

    #[test]
    fn pieces_cover_the_track_without_gaps() {
        let env: Vec<u8> = (0..50 * 600).map(|k| (k * 7 % 90) as u8).collect();
        let bounds = chunk_bounds(&env, 50);
        assert_eq!(bounds[0].0, 0.0);
        assert_eq!(bounds.last().map(|b| b.1), Some(600.0));
        for pair in bounds.windows(2) {
            assert_eq!(pair[0].1, pair[1].0);
            let len = pair[0].1 - pair[0].0;
            assert!((CHUNK_SEC - SLACK_SEC..=CHUNK_SEC + SLACK_SEC + 0.1).contains(&len));
        }
    }
}
