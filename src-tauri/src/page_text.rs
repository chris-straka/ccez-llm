//! Fetched markup to model-readable text for the native turn engine.
//!
//! Mirrors `src/lib/tools.ts` (`htmlToText`, `parseFeedItems`,
//! `parseSearchResults`, `formatFeedItems`) so a `fetch_url` result
//! reads the same whichever engine ran the turn. Before this module the
//! native engine handed the model raw HTML (up to 512 KiB of scripts and
//! nav per fetch), which burned context and tokens on Android.
//!
//! Zero new crates: a forgiving byte scanner over ASCII-lowercased
//! markup (same byte offsets as the original, so slices line up). It is
//! not an HTML parser and does not try to be — it only has to beat raw
//! markup, never throw, and agree with the TypeScript cleaner on the
//! shapes the tests pin.

/// Longest page text kept per fetch: mirrors `MAX_FETCH_TEXT_CHARS`.
const MAX_TEXT_CHARS: usize = 12000;
/// Most feed/search items kept: mirrors `MAX_FEED_ITEMS`.
const MAX_ITEMS: usize = 15;
/// Longest item description kept: mirrors `MAX_FEED_DESC_CHARS`.
const MAX_DESC_CHARS: usize = 200;

/// Elements whose whole subtree is dropped: mirrors `htmlToText`.
const SKIP_TAGS: &[&str] = &[
    "script", "style", "noscript", "nav", "header", "footer", "form", "template", "svg", "canvas",
    "iframe",
];

/// Tags whose boundaries break lines, so paragraphs don't glue together.
const BLOCK_TAGS: &[&str] = &[
    "p",
    "div",
    "br",
    "li",
    "tr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "section",
    "blockquote",
    "pre",
    "dd",
    "dt",
    "td",
    "th",
];

struct Item {
    title: String,
    link: String,
    description: String,
}

/// Tool-result text for one fetched page: search results, feed
/// headlines, or readable page text, each with the TypeScript engine's
/// one-line copy when nothing readable remains.
pub(crate) fn tool_text(url: &str, markup: &str) -> String {
    if is_search_url(url) {
        let text = format_items(&search_results(markup));
        return if text.is_empty() {
            "That search returned no results.".into()
        } else {
            text
        };
    }
    if looks_like_feed(markup) {
        let text = format_items(&feed_items(markup));
        return if text.is_empty() {
            "That feed had no readable headlines.".into()
        } else {
            text
        };
    }
    let text = html_to_text(markup);
    if text.is_empty() {
        "That page had no readable text.".into()
    } else {
        text
    }
}

/// Mirrors `isSearchUrl`: DuckDuckGo's no-JS HTML endpoint only.
fn is_search_url(url: &str) -> bool {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"));
    rest.and_then(|r| r.split(['/', '?', '#']).next())
        .is_some_and(|host| host.eq_ignore_ascii_case("html.duckduckgo.com"))
}

/// Mirrors `looksLikeFeed`.
fn looks_like_feed(text: &str) -> bool {
    let head: String = text
        .chars()
        .take(2000)
        .collect::<String>()
        .to_ascii_lowercase();
    head.contains("<rss")
        || head.contains("<feed")
        || (head.contains("<?xml") && (head.contains("<item") || head.contains("<entry")))
}

/// Mirrors `formatFeedItems`.
fn format_items(items: &[Item]) -> String {
    let lines: Vec<String> = items
        .iter()
        .map(|item| {
            let head = if item.description.is_empty() {
                item.title.clone()
            } else {
                format!("{} — {}", item.title, item.description)
            };
            if item.link.is_empty() {
                format!("- {head}")
            } else {
                format!("- {head} ({})", item.link)
            }
        })
        .collect();
    truncate_chars(&lines.join("\n"), MAX_TEXT_CHARS)
}

/// Mirrors `htmlToText`: skip-tag subtrees dropped, `<article>` /
/// `<main>` / `<body>` preferred as root, tags stripped, entities
/// decoded, whitespace collapsed per line, empty lines dropped.
fn html_to_text(html: &str) -> String {
    let cleaned = drop_skipped(html);
    let root = root_slice(&cleaned);
    let text = decode_entities(&strip_tags(root));
    let lines: Vec<String> = text
        .split('\n')
        .map(|line| {
            line.split([' ', '\t', '\r', '\u{a0}'])
                .filter(|w| !w.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|line| !line.is_empty())
        .collect();
    truncate_chars(&lines.join("\n"), MAX_TEXT_CHARS)
}

/// Organic DuckDuckGo results (ads dropped): mirrors `parseSearchResults`.
fn search_results(html: &str) -> Vec<Item> {
    let lower = html.to_ascii_lowercase();
    let mut out = Vec::new();
    // Each result opens a `<div class="result ...">`; the block runs to
    // the next one (or the end), which is enough to find its parts.
    let starts: Vec<usize> = find_all(&lower, "<div class=\"result ")
        .into_iter()
        .chain(find_all(&lower, "<div class=\"result\""))
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    for (i, &start) in starts.iter().enumerate() {
        if out.len() >= MAX_ITEMS {
            break;
        }
        let end = starts.get(i + 1).copied().unwrap_or(html.len());
        let block = &html[start..end];
        let block_lower = &lower[start..end];
        let open_end = block_lower.find('>').unwrap_or(0);
        if block_lower[..open_end].contains("result--ad") {
            continue;
        }
        let Some((anchor_tag, anchor_text)) =
            element_with_class(block, block_lower, "a", "result__a")
        else {
            continue;
        };
        let title = collapse(&decode_entities(&strip_tags(anchor_text)));
        let href = attr(anchor_tag, "href")
            .map(|h| decode_entities(&h))
            .unwrap_or_default();
        if title.is_empty() || href.is_empty() {
            continue;
        }
        let description = element_with_class(block, block_lower, "a", "result__snippet")
            .map(|(_, inner)| collapse(&decode_entities(&strip_tags(inner))))
            .unwrap_or_default();
        out.push(Item {
            title,
            link: unwrap_search_link(&href),
            description: truncate_chars(&description, MAX_DESC_CHARS),
        });
    }
    out
}

/// RSS `<item>` / Atom `<entry>` headlines: mirrors `parseFeedItems`
/// (title required, `<link>` text or `href`, description or summary).
fn feed_items(markup: &str) -> Vec<Item> {
    let lower = markup.to_ascii_lowercase();
    let tag = if find_open(&lower, "item", 0).is_some() {
        "item"
    } else {
        "entry"
    };
    let mut out = Vec::new();
    let mut from = 0;
    while out.len() < MAX_ITEMS {
        let Some((open_start, open_end)) = find_open(&lower, tag, from) else {
            break;
        };
        let close = lower[open_end..]
            .find(&format!("</{tag}"))
            .map_or(markup.len(), |i| open_end + i);
        let body = &markup[open_end..close];
        let body_lower = &lower[open_end..close];
        from = close.max(open_start + 1);
        let title = child_text(body, body_lower, "title");
        if title.is_empty() {
            continue;
        }
        let mut link = child_text(body, body_lower, "link");
        if link.is_empty() {
            if let Some((s, e)) = find_open(body_lower, "link", 0) {
                link = attr(&body[s..e], "href").unwrap_or_default();
            }
        }
        let mut description = child_text(body, body_lower, "description");
        if description.is_empty() {
            description = child_text(body, body_lower, "summary");
        }
        out.push(Item {
            title,
            link,
            description: truncate_chars(&description, MAX_DESC_CHARS),
        });
    }
    out
}

/// Text of the first `<name>` child, CDATA unwrapped, tags stripped.
fn child_text(body: &str, lower: &str, name: &str) -> String {
    let Some((_, open_end)) = find_open(lower, name, 0) else {
        return String::new();
    };
    if body[..open_end].ends_with("/>") {
        return String::new();
    }
    let close = lower[open_end..]
        .find(&format!("</{name}"))
        .map_or(body.len(), |i| open_end + i);
    let raw = body[open_end..close].trim();
    let raw = raw
        .strip_prefix("<![CDATA[")
        .and_then(|r| r.strip_suffix("]]>"))
        .map_or_else(|| decode_entities(&strip_tags(raw)), strip_tags);
    collapse(&raw)
}

/// `(open tag, inner markup)` of the first `<tag class="... class ...">`.
fn element_with_class<'a>(
    block: &'a str,
    lower: &str,
    tag: &str,
    class: &str,
) -> Option<(&'a str, &'a str)> {
    let mut from = 0;
    while let Some((start, end)) = find_open(lower, tag, from) {
        from = end;
        let open = &block[start..end];
        let classes = attr(open, "class").unwrap_or_default();
        if classes.split_whitespace().any(|c| c == class) {
            let close = lower[end..]
                .find(&format!("</{tag}"))
                .map_or(block.len(), |i| end + i);
            return Some((open, &block[end..close]));
        }
    }
    None
}

/// `(start, end)` byte range of the next `<name ...>` open tag at or
/// after `from` (whole-name match, so `<a` never hits `<article`).
fn find_open(lower: &str, name: &str, from: usize) -> Option<(usize, usize)> {
    let needle = format!("<{name}");
    let mut at = from;
    while let Some(i) = lower.get(at..)?.find(&needle) {
        let start = at + i;
        let after = start + needle.len();
        match lower.as_bytes().get(after) {
            Some(b'>' | b'/' | b' ' | b'\t' | b'\n' | b'\r') => {
                let end = lower[after..]
                    .find('>')
                    .map_or(lower.len(), |j| after + j + 1);
                return Some((start, end));
            }
            None => return None,
            _ => at = after,
        }
    }
    None
}

fn find_all(haystack: &str, needle: &str) -> Vec<usize> {
    haystack.match_indices(needle).map(|(i, _)| i).collect()
}

/// Quoted attribute value out of one open tag (case-insensitive name).
fn attr(open_tag: &str, name: &str) -> Option<String> {
    let lower = open_tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find(name) {
        let at = from + i;
        from = at + name.len();
        let boundary = at == 0 || matches!(lower.as_bytes()[at - 1], b' ' | b'\t' | b'\n' | b'\r');
        let rest = lower[from..].trim_start();
        if !boundary || !rest.starts_with('=') {
            continue;
        }
        let value_at = open_tag.len() - rest.len() + 1;
        let value = open_tag[value_at..].trim_start();
        let quote = value.chars().next()?;
        if quote == '"' || quote == '\'' {
            return value[1..]
                .find(quote)
                .map(|end| value[1..1 + end].to_string());
        }
        let end = value
            .find(|c: char| c.is_whitespace() || c == '>')
            .unwrap_or(value.len());
        return Some(value[..end].to_string());
    }
    None
}

/// Real target of a DuckDuckGo redirect (`//duckduckgo.com/l/?uddg=…`).
fn unwrap_search_link(href: &str) -> String {
    let Some(i) = href.find("uddg=") else {
        return if href.starts_with("//") {
            format!("https:{href}")
        } else {
            href.to_string()
        };
    };
    let encoded = href[i + 5..].split('&').next().unwrap_or("");
    percent_decode(encoded)
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16);
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                    out.push((h * 16 + l) as u8);
                    i += 3;
                    continue;
                }
                out.push(b'%');
            }
            b'+' => out.push(b' '),
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Markup with every skip-tag subtree and comment removed.
fn drop_skipped(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let mut cuts: Vec<(usize, usize)> = Vec::new();
    for (i, _) in lower.match_indices("<!--") {
        let end = lower[i..].find("-->").map_or(html.len(), |j| i + j + 3);
        cuts.push((i, end));
    }
    for tag in SKIP_TAGS {
        let mut from = 0;
        while let Some((start, open_end)) = find_open(&lower, tag, from) {
            let end = if lower[..open_end].ends_with("/>") {
                open_end
            } else {
                let close_tag = format!("</{tag}");
                lower[open_end..].find(&close_tag).map_or(html.len(), |j| {
                    let close = open_end + j;
                    lower[close..]
                        .find('>')
                        .map_or(html.len(), |k| close + k + 1)
                })
            };
            cuts.push((start, end));
            from = end;
        }
    }
    cuts.sort_unstable();
    let mut out = String::with_capacity(html.len());
    let mut at = 0;
    for (start, end) in cuts {
        if start >= at {
            out.push_str(&html[at..start]);
        }
        at = at.max(end);
    }
    if at < html.len() {
        out.push_str(&html[at..]);
    }
    out
}

/// First `<article>`, else `<main>`, else `<body>`, else everything.
fn root_slice(html: &str) -> &str {
    let lower = html.to_ascii_lowercase();
    for tag in ["article", "main", "body"] {
        if let Some((_, open_end)) = find_open(&lower, tag, 0) {
            let close = lower[open_end..]
                .find(&format!("</{tag}"))
                .map_or(html.len(), |j| open_end + j);
            return &html[open_end..close];
        }
    }
    html
}

/// Tags removed; block-tag boundaries become newlines.
fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(lt) = rest.find('<') {
        out.push_str(&rest[..lt]);
        let Some(gt) = rest[lt..].find('>') else {
            rest = "";
            break;
        };
        let name: String = rest[lt + 1..lt + gt]
            .trim_start_matches('/')
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_ascii_lowercase();
        if BLOCK_TAGS.contains(&name.as_str()) {
            out.push('\n');
        }
        rest = &rest[lt + gt + 1..];
    }
    out.push_str(rest);
    out
}

/// Named entities the web actually uses plus numeric references.
fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        let tail = &rest[amp..];
        let semi = tail.find(';').filter(|&i| i <= 10);
        let decoded = semi.and_then(|i| {
            let body = &tail[1..i];
            let ch = match body {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some('\u{a0}'),
                _ => body
                    .strip_prefix("#x")
                    .or_else(|| body.strip_prefix("#X"))
                    .and_then(|h| u32::from_str_radix(h, 16).ok())
                    .or_else(|| body.strip_prefix('#').and_then(|d| d.parse().ok()))
                    .and_then(char::from_u32),
            };
            ch.map(|c| (c, i + 1))
        });
        match decoded {
            Some((c, len)) => {
                out.push(c);
                rest = &tail[len..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        Some((i, _)) => text[..i].to_string(),
        None => text.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_text_prefers_article_and_drops_chrome() {
        let html = r#"<html><head><style>p{}</style><script>var x = "<p>";</script></head>
<body><nav>Menu</nav><header>Site</header>
<article><h1>Titre</h1><p>Le chat &amp; le   chien.</p><!-- ad --><p>Fin&nbsp;&#233;t&#xE9;.</p></article>
<footer>Legal</footer></body></html>"#;
        assert_eq!(
            tool_text("https://example.com/", html),
            "Titre\nLe chat & le chien.\nFin été."
        );
    }

    #[test]
    fn page_text_falls_back_to_body_and_reports_empty_pages() {
        assert_eq!(
            tool_text(
                "https://example.com/",
                "<body><div>Hallo</div><div>Welt</div></body>"
            ),
            "Hallo\nWelt"
        );
        assert_eq!(
            tool_text(
                "https://example.com/",
                "<html><body><script>x()</script></body></html>"
            ),
            "That page had no readable text."
        );
    }

    #[test]
    fn page_text_caps_at_the_typescript_limit() {
        let html = format!("<p>{}</p>", "é".repeat(MAX_TEXT_CHARS + 50));
        assert_eq!(
            tool_text("https://example.com/", &html).chars().count(),
            MAX_TEXT_CHARS
        );
    }

    #[test]
    fn feeds_read_as_headline_lines() {
        let rss = r#"<?xml version="1.0"?><rss><channel><title>Chan</title>
<item><title><![CDATA[Head one]]></title><link>https://example.com/1</link><description><![CDATA[<p>Desc one</p>]]></description></item>
<item><title>No &amp; link</title></item></channel></rss>"#;
        assert_eq!(
            tool_text("https://example.com/feed", rss),
            "- Head one — Desc one (https://example.com/1)\n- No & link"
        );
        let atom = r#"<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom</title><link href="https://example.com/a"/><summary>Sum</summary></entry></feed>"#;
        assert_eq!(
            tool_text("https://example.com/atom", atom),
            "- Atom — Sum (https://example.com/a)"
        );
    }

    #[test]
    fn search_pages_read_as_result_lines_without_ads() {
        let html = r#"<div class="serp">
<div class="result results_links result--ad"><h2><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Sponsored</a></h2></div>
<div class="result results_links web-result "><h2 class="result__title">
<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fde.wikipedia.org%2Fwiki%2FBundestagswahl_2025&amp;rut=2e1c">Bundestagswahl 2025 - Wikipedia</a></h2>
<a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">Die Wahl zum
 21. Deutschen <b>Bundestag</b> fand statt.</a></div>
<div class="result web-result"><a class="result__a" href="https://www.tagesschau.de/wahl/">Wahlarchiv</a></div>
</div>"#;
        assert_eq!(
            tool_text("https://html.duckduckgo.com/html/?q=wahl", html),
            "- Bundestagswahl 2025 - Wikipedia — Die Wahl zum 21. Deutschen Bundestag fand statt. (https://de.wikipedia.org/wiki/Bundestagswahl_2025)\n- Wahlarchiv (https://www.tagesschau.de/wahl/)"
        );
        assert_eq!(
            tool_text(
                "https://html.duckduckgo.com/html/?q=x",
                "<form>robot?</form>"
            ),
            "That search returned no results."
        );
    }

    #[test]
    fn search_host_gate_is_exact() {
        assert!(is_search_url("https://html.duckduckgo.com/html/?q=x"));
        assert!(!is_search_url("https://duckduckgo.com/?q=x"));
        assert!(!is_search_url("https://html.duckduckgo.com.evil.example/"));
    }

    #[test]
    fn percent_decode_handles_utf8_and_stray_percents() {
        assert_eq!(percent_decode("caf%C3%A9%20au%2"), "café au%2");
    }
}
