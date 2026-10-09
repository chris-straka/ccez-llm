//! Backend for ccez-llm's listening drills. The desktop shell calls
//! [`api::Listen`] directly; the `ccez-listen` binary serves the same
//! calls over HTTP for the phone and the web build.

pub mod api;
pub mod pick;
pub mod ytdlp;

pub use api::{storyboard_of, ChannelPage, Entry, Fetched, Listen, Sheet, Storyboard};
pub use pick::{AudioKind, AudioPick, CaptionKind, CaptionPick, VideoInfo};
