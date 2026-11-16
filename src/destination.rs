use std::net::{Ipv4Addr, Ipv6Addr};
use url::{Host, Url};

pub const MAX_URL_BYTES: usize = 8192;

#[derive(Debug, PartialEq, Eq)]
pub struct InvalidDestination;

/// Returns the URL parser's canonical representation, without fetching or resolving the destination.
pub fn validate_destination(
    input: &str,
    public_host: Option<&str>,
) -> Result<String, InvalidDestination> {
    if input.is_empty()
        || input.len() > MAX_URL_BYTES
        || input.trim() != input
        || input.chars().any(char::is_control)
        || input.contains('\\')
        || encoded_control(input)
    {
        return Err(InvalidDestination);
    }
    let url = Url::parse(input).map_err(|_| InvalidDestination)?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(InvalidDestination);
    }
    // Also reject an explicitly empty user-info section, which the parser normalizes away.
    let authority = input
        .split_once("://")
        .ok_or(InvalidDestination)?
        .1
        .split(['/', '?', '#'])
        .next()
        .ok_or(InvalidDestination)?;
    if authority.contains('@') {
        return Err(InvalidDestination);
    }
    let host = url.host().ok_or(InvalidDestination)?;
    let allowed = match host {
        Host::Ipv4(ip) => public_ipv4(ip),
        Host::Ipv6(ip) => public_ipv6(ip),
        Host::Domain(domain) => public_domain(domain),
    };
    if !allowed {
        return Err(InvalidDestination);
    }
    if let Some(own_host) = public_host {
        if url.host_str().is_some_and(|h| {
            h.trim_end_matches('.')
                .eq_ignore_ascii_case(own_host.trim_end_matches('.'))
        }) {
            return Err(InvalidDestination);
        }
    }
    let normalized = url.to_string();
    if normalized.len() > MAX_URL_BYTES {
        return Err(InvalidDestination);
    }
    Ok(normalized)
}

fn encoded_control(input: &str) -> bool {
    input.as_bytes().windows(3).any(|part| {
        part[0] == b'%'
            && std::str::from_utf8(&part[1..])
                .ok()
                .and_then(|hex| u8::from_str_radix(hex, 16).ok())
                .is_some_and(|byte| byte <= 31 || byte == 127)
    })
}

fn public_domain(domain: &str) -> bool {
    let domain = domain.trim_end_matches('.');
    if !domain.contains('.') || domain.len() > 253 {
        return false;
    }
    if [
        "localhost",
        "local",
        "internal",
        "lan",
        "home",
        "localdomain",
    ]
    .iter()
    .any(|suffix| domain == *suffix || domain.ends_with(&format!(".{suffix}")))
    {
        return false;
    }
    domain.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    })
}

fn public_ipv4(ip: Ipv4Addr) -> bool {
    let address = u32::from(ip);
    // Conservative exclusion of non-public/special-use ranges, including documentation and multicast.
    ![
        (0x00000000, 8),
        (0x0a000000, 8),
        (0x64400000, 10),
        (0x7f000000, 8),
        (0xa9fe0000, 16),
        (0xac100000, 12),
        (0xc0000000, 24),
        (0xc0000200, 24),
        (0xc0586300, 24),
        (0xc0a80000, 16),
        (0xc6120000, 15),
        (0xc6336400, 24),
        (0xcb007100, 24),
        (0xe0000000, 4),
        (0xf0000000, 4),
    ]
    .iter()
    .any(|(network, prefix)| address & (u32::MAX << (32 - prefix)) == *network)
}

fn public_ipv6(ip: Ipv6Addr) -> bool {
    let s = ip.segments();
    // Allow global-unicast only; exclude mapped, translation, documentation and deprecated 6to4.
    (0x2000..=0x3fff).contains(&s[0])
        && !(s[0] == 0x2001 && (s[1] <= 0x01ff || s[1] == 0x0db8))
        && s[0] != 0x2002
        && !(s[0] == 0x3fff && s[1] & 0xf000 == 0)
}
