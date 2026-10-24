from app.integrations.storage import influx_csv_has_rows


def test_influx_annotated_csv_data_row_detection() -> None:
    body = """#datatype,string,long,dateTime:RFC3339,double
#group,false,false,false,false
#default,_result,,,
,result,table,_time,_value
,_result,0,2026-10-15T04:43:20Z,0.15
"""
    assert influx_csv_has_rows(body)


def test_influx_data_row_with_empty_result_label_is_also_detected() -> None:
    assert influx_csv_has_rows(",,7,2026-10-15T04:43:20Z,0.15\n")


def test_influx_annotated_csv_without_data_is_empty() -> None:
    body = """#datatype,string,long,dateTime:RFC3339,double
#group,false,false,false,false
#default,_result,,,
,result,table,_time,_value
"""
    assert not influx_csv_has_rows(body)
