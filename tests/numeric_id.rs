#![cfg(feature = "server")]
use numeric_shortener::redirect::parse_id;

#[test]
fn accepts_positive_decimal_bigint_endpoints() {
    assert_eq!(parse_id("1"), Ok(1));
    assert_eq!(parse_id("9223372036854775807"), Ok(i64::MAX));
}

#[test]
fn rejects_noncanonical_or_out_of_range_numbers() {
    for input in [
        "",
        "0",
        "-1",
        "+1",
        "01",
        "0001",
        "1.0",
        "1e2",
        "1 ",
        " 1",
        "abc",
        "１２",
        "١",
        "%31",
        "%2B1",
        "9223372036854775808",
        "999999999999999999999999999999999999",
    ] {
        assert!(parse_id(input).is_err(), "must reject {input:?}");
    }
}
