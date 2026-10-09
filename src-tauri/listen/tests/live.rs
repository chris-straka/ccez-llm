//! Against real YouTube: `cargo test -- --ignored`. Not in CI (network,
//! and YouTube changes under it); run it when the drill stops loading.

use ccez_listen::{AudioKind, CaptionKind, Listen};

#[tokio::test]
#[ignore]
async fn live_search_channel_and_fetch() {
    let dir = std::env::temp_dir().join(format!("ccez-listen-live-{}", std::process::id()));
    let listen = Listen::new(&dir);

    let channels = listen
        .search("David Pakman", "channel", 5)
        .await
        .expect("channel search");
    assert!(channels
        .iter()
        .any(|c| c.id == "https://www.youtube.com/@thedavidpakmanshow"));
    let videos = listen
        .search("David Pakman Trump", "video", 10)
        .await
        .expect("video search");
    assert!(!videos.is_empty());

    let page = listen
        .channel("@thedavidpakmanshow", 6)
        .await
        .expect("channel page");
    assert_eq!(page.name, "David Pakman");
    assert_eq!(page.videos.len(), 6);

    let ids: Vec<String> = page.videos.iter().map(|v| v.id.clone()).collect();
    let infos = listen.videos(&ids, "fr").await;
    assert!(!infos.is_empty());
    let dubbed = infos
        .iter()
        .find(|v| v.audio.is_some() && v.captions.is_some())
        .expect("a french dub");
    assert_eq!(dubbed.audio.as_ref().unwrap().kind, AudioKind::Dub);

    let fetched = listen.fetch(&dubbed.id, "fr").await.expect("fetch");
    assert_eq!(fetched.caption_kind, CaptionKind::Asr);
    assert!(fetched.captions.contains("\"events\""));
    let size = std::fs::metadata(&fetched.audio_path)
        .expect("audio file")
        .len();
    assert!(size > 100_000, "audio {size} bytes");
    assert!(fetched.storyboard.is_some());
    // A second fetch reads the cache.
    let again = listen.fetch(&dubbed.id, "fr").await.expect("cached");
    assert_eq!(again.audio_path, fetched.audio_path);
    eprintln!("{} · {} bytes · {}", dubbed.title, size, fetched.audio_mime);

    // The picture: a few MB of H.264, cached like the audio.
    let video = listen.video_path(&dubbed.id).await.expect("video");
    let vsize = std::fs::metadata(&video).expect("video file").len();
    assert!(vsize > 1_000_000, "video {vsize} bytes");
    assert_eq!(listen.video_path(&dubbed.id).await.expect("cached"), video);
    eprintln!("video · {vsize} bytes");

    let native = listen
        .search("FRANCE 24 Le Canada peut-il résister à Trump", "video", 5)
        .await
        .expect("search");
    let info = listen.video(&native[0].id, "fr").await.expect("info");
    eprintln!(
        "native check: {} -> {:?}",
        info.title,
        info.audio.as_ref().map(|a| a.kind)
    );
    let _ = std::fs::remove_dir_all(&dir);
}
