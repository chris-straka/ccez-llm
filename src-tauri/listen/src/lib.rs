//! Listening drills backend: find a video's audio in a language and
//! fetch it with its word-timed captions, straight from YouTube's own
//! API (no yt-dlp), so it runs on desktop and phone alike.

mod api;
mod client;
pub mod youtube;

pub use api::{Fetched, Listen};
pub use youtube::{
    AudioKind, AudioPick, CaptionKind, CaptionPick, ChannelPage, Entry, Sheet, Storyboard,
    VideoInfo,
};

pub type Result<T> = std::result::Result<T, String>;
