from collections import defaultdict
from datetime import datetime


def median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def _month_key(contract_date: str) -> str:
    return f"{contract_date[:4]}-{contract_date[4:6]}"


def build_district_summary(rows: list[dict], district: str) -> dict:
    district_rows = [
        row for row in rows
        if row.get("district") == district
        and row.get("contract_type") == "전세"
        and row.get("house_type") == "아파트"
    ]

    monthly_values = defaultdict(list)
    yearly_values = defaultdict(list)
    per_sqm_values = []
    all_deposits = []
    dates = []

    for row in district_rows:
        date = row["contract_date"]
        deposit = row["deposit_manwon"]
        try:
            datetime.strptime(date, "%Y%m%d")
        except (TypeError, ValueError):
            continue
        if deposit < 0:
            continue

        year = date[:4]
        month = _month_key(date)
        all_deposits.append(deposit)
        monthly_values[month].append(deposit)
        yearly_values[year].append(deposit)
        dates.append(date)

        area = row.get("area_sqm")
        if isinstance(area, (int, float)) and area > 0:
            per_sqm_values.append(deposit / area)

    years = sorted(yearly_values)
    yoy = None
    if len(years) >= 2:
        previous = median(yearly_values[years[-2]])
        current = median(yearly_values[years[-1]])
        if previous and current is not None:
            yoy = ((current - previous) / previous) * 100

    monthly = [
        {"month": month, "median_deposit_manwon": median(values)}
        for month, values in sorted(monthly_values.items())
    ]
    yearly_counts = [
        {"year": year, "count": len(yearly_values[year])}
        for year in years
    ]

    return {
        "district": district,
        "period": {
            "start": min(dates) if dates else None,
            "end": max(dates) if dates else None,
            "contract_years": years,
        },
        "transaction_count": len(all_deposits),
        "median_deposit_manwon": median(all_deposits),
        "deposit_yoy_percent": yoy,
        "monthly_median_deposit": monthly,
        "yearly_transaction_count": yearly_counts,
        "median_deposit_per_sqm": median(per_sqm_values),
    }

