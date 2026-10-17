import json
import math
from datetime import datetime
from urllib.parse import quote, urlencode

from js import fetch


BASE_URL = "http://openapi.seoul.go.kr:8088"
SERVICE = "tbLnOpendataRentV"
PAGE_SIZE = 1000
MAX_PAGES_PER_REQUEST = 49
DISTRICT_CODES = {
    "종로구": "11110", "중구": "11140", "용산구": "11170", "성동구": "11200",
    "광진구": "11215", "동대문구": "11230", "중랑구": "11260", "성북구": "11290",
    "강북구": "11305", "도봉구": "11320", "노원구": "11350", "은평구": "11380",
    "서대문구": "11410", "마포구": "11440", "양천구": "11470", "강서구": "11500",
    "구로구": "11530", "금천구": "11545", "영등포구": "11560", "동작구": "11590",
    "관악구": "11620", "서초구": "11650", "강남구": "11680", "송파구": "11710",
    "강동구": "11740",
}


class SeoulApiError(Exception):
    """Raised when the Seoul OpenAPI response is missing or incomplete."""


async def _request_page(
    api_key: str, start: int, end: int, district: str, year: int
) -> dict:
    district_code = DISTRICT_CODES.get(district)
    if district_code is None:
        raise SeoulApiError("올바르지 않은 자치구입니다.")
    key_path = quote(api_key, safe="")
    # Filter at the API so only one district, one registration year, and apartments
    # are paginated and transferred to the Worker.
    filters = urlencode(
        {"RCPT_YR": str(year), "CGG_CD": district_code, "BLDG_USG": "아파트"}
    )
    url = (
        f"{BASE_URL}/{key_path}/json/{SERVICE}/{start}/{end}"
        f"?{filters}"
    )
    try:
        response = await fetch(url)
        status = int(response.status)
        body = str(await response.text())
    except Exception as error:
        # Do not include the request URL or exception text here; it may contain the API key.
        raise SeoulApiError("서울시 OpenAPI에 연결할 수 없습니다.") from error

    if status < 200 or status >= 300:
        raise SeoulApiError(f"서울시 OpenAPI HTTP {status}")
    try:
        payload = json.loads(body)
    except (TypeError, ValueError) as error:
        raise SeoulApiError("서울시 OpenAPI 응답이 JSON 형식이 아닙니다.") from error

    service = payload.get(SERVICE)
    if not isinstance(service, dict):
        raise SeoulApiError("서울시 OpenAPI 응답에 서비스 데이터가 없습니다.")
    result = service.get("RESULT", {})
    if not isinstance(result, dict):
        raise SeoulApiError("서울시 OpenAPI 결과 상태가 올바르지 않습니다.")
    if result.get("CODE") == "INFO-200":
        return {"total": 0, "rows": []}
    if result.get("CODE") != "INFO-000":
        code = str(result.get("CODE", "UNKNOWN"))
        # Only include the provider's result code; never echo request data or credentials.
        raise SeoulApiError(f"서울시 OpenAPI 오류 코드: {code}")
    if "list_total_count" not in service:
        raise SeoulApiError("서울시 OpenAPI 응답에 전체 건수가 없습니다.")
    try:
        total = int(service["list_total_count"])
    except (TypeError, ValueError) as error:
        raise SeoulApiError("서울시 OpenAPI 전체 건수가 숫자가 아닙니다.") from error
    if total < 0:
        raise SeoulApiError("서울시 OpenAPI 전체 건수가 음수입니다.")
    rows = service.get("row", [])
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise SeoulApiError("서울시 OpenAPI 행 데이터가 올바르지 않습니다.")
    return {"total": total, "rows": rows}


def normalize_record(row: dict) -> dict | None:
    """Map Seoul response fields to the dashboard's internal record shape."""
    try:
        deposit = float(row.get("GRFE", ""))
        contract_date = str(row.get("CTRT_DAY", ""))
        district = str(row.get("CGG_NM", "")).strip()
        contract_type = str(row.get("RENT_SE", "")).strip()
        house_type = str(row.get("BLDG_USG", "")).strip()
    except (TypeError, ValueError):
        return None

    try:
        area = float(row.get("RENT_AREA", ""))
    except (TypeError, ValueError):
        area = None

    if len(contract_date) != 8 or not contract_date.isdigit():
        return None
    if not district or not math.isfinite(deposit) or deposit < 0:
        return None
    if area is not None and not math.isfinite(area):
        area = None
    return {
        "district": district,
        "contract_type": contract_type,
        "house_type": house_type,
        "contract_date": contract_date,
        "deposit_manwon": deposit,
        "area_sqm": area,
    }


async def fetch_rent_records(api_key: str, district: str) -> list[dict]:
    """Fetch recent-three-year apartment rent rows for one Seoul district."""
    current_year = datetime.now().year
    years = range(current_year - 2, current_year + 1)
    records = []
    pages_requested = 0

    for year in years:
        first = await _request_page(api_key, 1, PAGE_SIZE, district, year)
        total = first["total"]
        page_count = (total + PAGE_SIZE - 1) // PAGE_SIZE
        if pages_requested + page_count > MAX_PAGES_PER_REQUEST:
            raise SeoulApiError(
                "아파트 최근 3년 자료가 Worker 조회 한도를 초과했습니다."
            )
        if len(first["rows"]) != min(total, PAGE_SIZE):
            raise SeoulApiError("서울시 OpenAPI 첫 페이지가 불완전합니다.")
        records.extend(
            item for row in first["rows"] if (item := normalize_record(row))
        )
        pages_requested += 1

        start = PAGE_SIZE + 1
        while start <= total:
            end = min(start + PAGE_SIZE - 1, total)
            page = await _request_page(api_key, start, end, district, year)
            if page["total"] != total or len(page["rows"]) != end - start + 1:
                raise SeoulApiError(
                    "서울시 OpenAPI 페이지 수가 바뀌어 전체 자료를 보장할 수 없습니다."
                )
            records.extend(
                item for row in page["rows"] if (item := normalize_record(row))
            )
            pages_requested += 1
            start = end + 1

    return records
