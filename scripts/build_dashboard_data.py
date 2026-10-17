"""Fetch recent Seoul apartment jeonse data and build static dashboard summaries.

Run from the assignment2 directory with:
    python scripts/build_dashboard_data.py

The API key is read from .dev.vars and is never written to the generated file.
"""

from __future__ import annotations

import json
import math
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from analytics import build_district_summary  # noqa: E402


BASE_URL = "http://openapi.seoul.go.kr:8088"
SERVICE = "tbLnOpendataRentV"
PAGE_SIZE = 1000
MAX_RETRIES = 4
DISTRICTS = {
    "종로구": "11110", "중구": "11140", "용산구": "11170", "성동구": "11200",
    "광진구": "11215", "동대문구": "11230", "중랑구": "11260", "성북구": "11290",
    "강북구": "11305", "도봉구": "11320", "노원구": "11350", "은평구": "11380",
    "서대문구": "11410", "마포구": "11440", "양천구": "11470", "강서구": "11500",
    "구로구": "11530", "금천구": "11545", "영등포구": "11560", "동작구": "11590",
    "관악구": "11620", "서초구": "11650", "강남구": "11680", "송파구": "11710",
    "강동구": "11740",
}


def read_api_key() -> str:
    vars_path = ROOT / ".dev.vars"
    if not vars_path.exists():
        raise RuntimeError(".dev.vars 파일에서 SEOUL_API_KEY를 찾을 수 없습니다.")
    for line in vars_path.read_text(encoding="utf-8").splitlines():
        name, separator, value = line.partition("=")
        if separator and name.strip() == "SEOUL_API_KEY" and value.strip():
            return value.strip().strip('"').strip("'")
    raise RuntimeError(".dev.vars 파일에서 SEOUL_API_KEY를 찾을 수 없습니다.")


def fetch_page(api_key: str, district_code: str, year: int, start: int, end: int) -> dict:
    # Seoul OpenAPI filters are positional path segments, not query-string values.
    optional_params = [
        str(year), district_code, "", "", "", "", "", "", "", "아파트"
    ]
    suffix = "/".join(quote(value, safe="") for value in optional_params)
    url = (
        f"{BASE_URL}/{quote(api_key, safe='')}/json/{SERVICE}/"
        f"{start}/{end}/{suffix}"
    )
    request = Request(url, headers={"Accept": "application/json"})

    for attempt in range(MAX_RETRIES):
        try:
            with urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
            break
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
            if attempt + 1 == MAX_RETRIES:
                raise RuntimeError(
                    f"{year}년 {district_code} 자료 요청 실패 ({type(error).__name__})."
                ) from error
            time.sleep(1.5 * (attempt + 1))

    service = payload.get(SERVICE)
    if not isinstance(service, dict):
        raise RuntimeError(f"{year}년 {district_code} 응답에 서비스 자료가 없습니다.")
    result = service.get("RESULT", {})
    if result.get("CODE") == "INFO-200":
        return {"total": 0, "rows": []}
    if result.get("CODE") != "INFO-000":
        raise RuntimeError(
            f"서울시 API 오류 {result.get('CODE', 'UNKNOWN')} "
            f"({year}년 {district_code})."
        )
    total = int(service.get("list_total_count", 0))
    rows = service.get("row", [])
    if not isinstance(rows, list):
        raise RuntimeError(f"{year}년 {district_code} 응답 행이 올바르지 않습니다.")
    return {"total": total, "rows": rows}


def normalize(row: dict, district: str, recent_years: set[str]) -> dict | None:
    if str(row.get("CGG_NM", "")).strip() != district:
        return None
    if str(row.get("RENT_SE", "")).strip() != "전세":
        return None
    if str(row.get("BLDG_USG", "")).strip() != "아파트":
        return None
    date = str(row.get("CTRT_DAY", "")).strip()
    if not re.fullmatch(r"\d{8}", date) or date[:4] not in recent_years:
        return None
    try:
        datetime.strptime(date, "%Y%m%d")
        deposit = float(row.get("GRFE", ""))
    except (TypeError, ValueError):
        return None
    if not math.isfinite(deposit) or deposit < 0:
        return None
    try:
        area = float(row.get("RENT_AREA", ""))
        if not math.isfinite(area):
            area = None
    except (TypeError, ValueError):
        area = None
    return {
        "district": district,
        "contract_type": "전세",
        "house_type": "아파트",
        "contract_date": date,
        "deposit_manwon": deposit,
        "area_sqm": area,
    }


def collect_district(api_key: str, district: str, code: str, years: list[int]) -> tuple[str, list[dict]]:
    recent_years = {str(year) for year in years}
    records: list[dict] = []
    request_count = 0
    for year in years:
        first = fetch_page(api_key, code, year, 1, PAGE_SIZE)
        request_count += 1
        total = first["total"]
        expected = min(total, PAGE_SIZE)
        if len(first["rows"]) != expected:
            raise RuntimeError(f"{year}년 {district} 첫 페이지 자료가 불완전합니다.")
        pages = [(1, first)]
        for start in range(PAGE_SIZE + 1, total + 1, PAGE_SIZE):
            end = min(start + PAGE_SIZE - 1, total)
            page = fetch_page(api_key, code, year, start, end)
            request_count += 1
            if page["total"] != total or len(page["rows"]) != end - start + 1:
                raise RuntimeError(f"{year}년 {district} 페이지 자료가 불완전합니다.")
            pages.append((start, page))
        for _, page in pages:
            records.extend(
                item for row in page["rows"]
                if (item := normalize(row, district, recent_years)) is not None
            )
    return district, records


def main() -> None:
    current_year = datetime.now().year
    years = list(range(current_year - 2, current_year + 1))
    api_key = read_api_key()
    results: dict[str, list[dict]] = {}

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(collect_district, api_key, name, code, years): name
            for name, code in DISTRICTS.items()
        }
        for future in as_completed(futures):
            district = futures[future]
            name, records = future.result()
            results[name] = records
            print(f"완료: {district} ({len(records):,}건)", flush=True)

    summaries = {
        district: build_district_summary(results[district], district)
        for district in DISTRICTS
    }
    output = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "years": years,
        "source": "서울시 열린데이터광장 서울시 부동산 전월세가 정보 OpenAPI",
        "districts": summaries,
    }
    target = ROOT / "public" / "data" / "dashboard-summary.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"요약 파일 저장 완료: {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
