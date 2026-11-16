use numeric_shortener::destination::validate_destination;

#[test]
fn preserves_destination_path_query_and_fragment() {
    assert_eq!(
        validate_destination("https://example.com/a%2Fb?q=a+b&x=%23#section", None),
        Ok("https://example.com/a%2Fb?q=a+b&x=%23#section".into())
    );
}

#[test]
fn accepts_public_http_https_and_records_parser_normalization() {
    for (input, expected) in [
        ("http://example.com", "http://example.com/"),
        (
            "HTTP://EXAMPLE.COM:80/a/../b?q=a+b#x",
            "http://example.com/b?q=a+b#x",
        ),
        (
            "https://bücher.example/한글?q=%2F#x",
            "https://xn--bcher-kva.example/%ED%95%9C%EA%B8%80?q=%2F#x",
        ),
        ("https://8.8.8.8/dns-query", "https://8.8.8.8/dns-query"),
        (
            "https://[2606:4700:4700::1111]/",
            "https://[2606:4700:4700::1111]/",
        ),
    ] {
        assert_eq!(validate_destination(input, None), Ok(expected.into()));
    }
}

#[test]
fn enforces_utf8_and_canonical_byte_limits() {
    let at_limit = format!("https://example.com/{}", "a".repeat(8172));
    assert!(validate_destination(&at_limit, None).is_ok());
    assert!(validate_destination(&(at_limit + "a"), None).is_err());
    assert!(
        validate_destination(&format!("https://example.com/{}", "한".repeat(2800)), None).is_err()
    );
    // Raw UTF-8 fits, but percent encoding would exceed the stored/header limit.
    assert!(
        validate_destination(&format!("https://example.com/{}", "한".repeat(1000)), None).is_err()
    );
}

#[test]
fn rejects_own_public_host_even_with_case_and_trailing_dot() {
    assert!(validate_destination("https://SHORT.EXAMPLE.:444/123", Some("short.example")).is_err());
    assert!(validate_destination("https://other.example/123", Some("short.example")).is_ok());
}

#[test]
fn rejects_unsafe_destinations_including_alternate_ip_spellings() {
    for input in [
        "",
        "not a URL",
        "/relative",
        "ftp://example.com/file",
        "javascript:alert(1)",
        "https://user:secret@example.com/",
        "https://@example.com/",
        "http://localhost/",
        "http://a.localhost/",
        "http://intranet/",
        "http://router.local/",
        "http://127.0.0.1/",
        "http://127.1/",
        "http://2130706433/",
        "http://0x7f000001/",
        "http://0177.0.0.1/",
        "http://10.0.0.1/",
        "http://172.16.1.1/",
        "http://192.168.0.1/",
        "http://169.254.169.254/",
        "http://100.64.0.1/",
        "http://0.0.0.0/",
        "http://224.0.0.1/",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://[::ffff:7f00:1]/",
        "http://[fc00::1]/",
        "http://[fe80::1]/",
        "http://[2001:db8::1]/",
        "https://example.com/\r\nX-Test:1",
        "https://exam\tple.com/",
        "https://example.com/%0d%0a",
        "https://example.com/\u{7f}",
        " https://example.com/",
        "https://example.com\\hidden",
        "https://bad..example.com/",
        "https://-bad.example.com/",
    ] {
        assert!(
            validate_destination(input, None).is_err(),
            "must reject {input:?}"
        );
    }
}
