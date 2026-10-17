from datetime import datetime
from urllib.parse import parse_qs, urlsplit

from workers import Response, WorkerEntrypoint
from js import caches

from analytics import build_district_summary
from seoul_api import SeoulApiError, fetch_rent_page, fetch_rent_records


DISTRICTS = [
    "종로구", "중구", "용산구", "성동구", "광진구", "동대문구", "중랑구",
    "성북구", "강북구", "도봉구", "노원구", "은평구", "서대문구", "마포구",
    "양천구", "강서구", "구로구", "금천구", "영등포구", "동작구", "관악구",
    "서초구", "강남구", "송파구", "강동구",
]

PAGE_SIZE = 1000
MAX_SUMMARY_RECORDS = 100_000


def json_error(code: str, message: str, status: int) -> Response:
    return Response.json(
        {"error": {"code": code, "message": message}},
        status=status,
        headers={"Cache-Control": "no-store"},
    )


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        url = urlsplit(str(request.url))
        method = str(request.method).upper()

        if url.path == "/api/districts":
            return Response.json({"districts": DISTRICTS})

        if url.path == "/api/records" and method == "GET":
            query = parse_qs(url.query)
            district = query.get("district", [""])[0]
            if district not in DISTRICTS:
                return json_error("INVALID_DISTRICT", "자치구를 선택해 주세요.", 400)
            try:
                year = int(query.get("year", ["0"])[0])
                start = int(query.get("start", ["0"])[0])
            except (TypeError, ValueError):
                return json_error("INVALID_PAGE", "자료 페이지 요청이 올바르지 않습니다.", 400)

            current_year = datetime.now().year
            if year not in range(current_year - 2, current_year + 1):
                return json_error("INVALID_YEAR", "최근 3개 연도만 조회할 수 있습니다.", 400)
            if start < 1 or (start - 1) % PAGE_SIZE != 0:
                return json_error("INVALID_PAGE", "자료 페이지 요청이 올바르지 않습니다.", 400)

            try:
                cached = await caches.default.match(request)
                if cached is not None:
                    return cached
            except Exception:
                pass

            api_key = getattr(self.env, "SEOUL_API_KEY", None)
            if not api_key:
                return json_error(
                    "MISSING_API_KEY",
                    "서버의 서울시 API 키 설정을 확인해 주세요.",
                    503,
                )

            try:
                page = await fetch_rent_page(
                    str(api_key), district, year, start
                )
                response = Response.json(
                    {
                        "district": district,
                        "year": year,
                        "start": start,
                        "page_size": PAGE_SIZE,
                        "total": page["total"],
                        "records": page["records"],
                    },
                    headers={"Cache-Control": "public, max-age=21600"},
                )
                try:
                    await caches.default.put(request, response.clone())
                except Exception:
                    pass
                return response
            except SeoulApiError as error:
                return json_error(
                    "SEOUL_API_ERROR",
                    f"서울시 API 요청 실패: {error}",
                    502,
                )
            except Exception:
                return json_error(
                    "SEOUL_API_ERROR",
                    "서울시 자료 페이지를 처리하지 못했습니다.",
                    502,
                )

        if url.path == "/api/summary" and method == "POST":
            try:
                body = await request.json()
            except Exception:
                return json_error("INVALID_BODY", "분석 요청 자료를 읽지 못했습니다.", 400)
            district = body.get("district", "") if isinstance(body, dict) else ""
            records = body.get("records") if isinstance(body, dict) else None
            if district not in DISTRICTS or not isinstance(records, list):
                return json_error("INVALID_BODY", "분석 요청 자료가 올바르지 않습니다.", 400)
            if len(records) > MAX_SUMMARY_RECORDS:
                return json_error(
                    "TOO_MANY_RECORDS",
                    "분석 가능한 거래 건수를 초과했습니다.",
                    413,
                )
            try:
                return Response.json(
                    build_district_summary(records, district),
                    headers={"Cache-Control": "no-store"},
                )
            except Exception:
                return json_error(
                    "SUMMARY_ERROR",
                    "분석 결과를 만드는 중 문제가 발생했습니다.",
                    500,
                )

        # Keep the old GET endpoint available for already cached summaries and links.
        if url.path == "/api/summary" and method == "GET":
            query = parse_qs(url.query)
            district = query.get("district", [""])[0]
            if district not in DISTRICTS:
                return json_error("INVALID_DISTRICT", "자치구를 선택해 주세요.", 400)
            try:
                cached = await caches.default.match(request)
                if cached is not None:
                    return cached
            except Exception:
                pass
            api_key = getattr(self.env, "SEOUL_API_KEY", None)
            if not api_key:
                return json_error(
                    "MISSING_API_KEY",
                    "서버의 서울시 API 키 설정을 확인해 주세요.",
                    503,
                )
            try:
                records = await fetch_rent_records(str(api_key), district)
                summary = build_district_summary(records, district)
                return Response.json(
                    summary,
                    headers={"Cache-Control": "public, max-age=21600"},
                )
            except SeoulApiError as error:
                return json_error(
                    "SEOUL_API_ERROR",
                    f"서울시 API 요청 실패: {error}",
                    502,
                )

        if url.path.startswith("/api/"):
            return json_error("NOT_FOUND", "요청한 API 경로를 찾을 수 없습니다.", 404)

        return await self.env.ASSETS.fetch(request)
