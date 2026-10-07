// Share extension: the iOS counterpart of Android's ACTION_SEND share
// target. Takes the shared text (or link), opens the app through
// ccez-llm://send?text=..., and the app prefills a new prompt through
// the same `annotate-external` path Android shares use (desktop.rs
// route_link). No UI of its own: it hands off and closes.
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private var handedOff = false

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !handedOff else { return }
        handedOff = true
        loadSharedText { [weak self] text in
            guard let self else { return }
            if let text, let url = Self.sendURL(for: text) {
                self.open(url)
            }
            self.extensionContext?.completeRequest(returningItems: nil)
        }
    }

    /// First plain-text attachment, else the first URL, else the
    /// item's attributed text (what Safari's selection share carries).
    private func loadSharedText(_ done: @escaping (String?) -> Void) {
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        let fallback = items.compactMap { $0.attributedContentText?.string }.first
        let finish: (String?) -> Void = { text in
            DispatchQueue.main.async { done(text ?? fallback) }
        }
        if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, _ in
                finish(item as? String)
            }
        } else if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
            provider.loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
                finish((item as? URL)?.absoluteString)
            }
        } else {
            finish(nil)
        }
    }

    static func sendURL(for text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        var parts = URLComponents()
        parts.scheme = "ccez-llm"
        parts.host = "send"
        // The app caps shares at 4000 characters too (annotate.rs).
        parts.queryItems = [URLQueryItem(name: "text", value: String(trimmed.prefix(4000)))]
        // `+` would read as a space in the app's decoder.
        parts.percentEncodedQuery = parts.percentEncodedQuery?
            .replacingOccurrences(of: "+", with: "%2B")
        return parts.url
    }

    /// Extensions get no UIApplication.shared; the host app's
    /// UIApplication is still on the responder chain.
    private func open(_ url: URL) {
        var responder: UIResponder? = self
        while let current = responder {
            if let app = current as? UIApplication {
                app.open(url, options: [:], completionHandler: nil)
                return
            }
            responder = current.next
        }
    }
}
