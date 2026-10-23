fn main() {
    // The dev binary runs unbundled, so it has no Info.plist and asking
    // for speech recognition would kill it. Debug builds embed the
    // usage keys in the binary instead (bundles merge Info.plist), as
    // do test binaries (`hears_a_cached_track`).
    let mac = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos");
    if mac && std::env::var("PROFILE").as_deref() == Ok("debug") {
        let plist = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("dev-Info.plist");
        println!("cargo:rerun-if-changed={}", plist.display());
        println!(
            "cargo:rustc-link-arg=-Wl,-sectcreate,__TEXT,__info_plist,{}",
            plist.display()
        );
    }
    tauri_build::build()
}
