"""Build src/data/airports.json from OurAirports (types/IATA) + mwgg/Airports (IANA time zones).

Usage: python3 scripts/build-airports.py ourairports.csv mwgg-airports.json
"""
import csv, json, math, sys

oa_path, tz_path = sys.argv[1], sys.argv[2]
tzdb = json.load(open(tz_path))
by_iata = {v["iata"]: v for v in tzdb.values() if v.get("iata")}
with_tz = [v for v in tzdb.values() if v.get("tz")]

def nearest_tz(lat, lon):
    best = min(with_tz, key=lambda v: (v["lat"] - lat) ** 2 + ((v["lon"] - lon) * math.cos(math.radians(lat))) ** 2)
    return best["tz"]

# French / common names travellers actually type.
ALIASES = {
    "ICN": "Seoul Séoul", "GMP": "Seoul Séoul", "PKX": "Beijing Pékin", "PEK": "Pékin", "HND": "Tokyo",
    "LGA": "New York", "SIN": "Singapour", "CAI": "Le Caire Cairo", "MEX": "Mexico", "LHR": "Londres",
    "LGW": "Londres London", "STN": "Londres London", "LCY": "Londres London", "BCN": "Barcelone",
    "FCO": "Rome", "VCE": "Venise", "LIS": "Lisbonne", "ATH": "Athènes", "CPH": "Copenhague",
    "BKK": "Bangkok", "HKG": "Hong Kong", "SGN": "Hô Chi Minh Saigon", "HAN": "Hanoï", "CPT": "Le Cap",
    "YUL": "Montréal", "YYZ": "Toronto", "PTP": "Guadeloupe", "FDF": "Martinique", "RUN": "La Réunion",
    "PPT": "Tahiti Papeete", "NOU": "Nouméa Nouvelle-Calédonie", "CAY": "Guyane", "MRU": "Maurice",
    "DPS": "Bali", "MLE": "Maldives", "SYD": "Sydney", "MEL": "Melbourne", "AKL": "Auckland",
    "GRU": "São Paulo Sao Paulo", "GIG": "Rio de Janeiro", "EZE": "Buenos Aires", "SCL": "Santiago du Chili",
    "BOG": "Bogota", "LIM": "Lima", "HAV": "La Havane", "CUN": "Cancun", "PUJ": "Punta Cana",
    "DXB": "Dubaï", "DOH": "Doha", "AUH": "Abu Dhabi", "IST": "Istanbul", "TLV": "Tel Aviv",
    "RAK": "Marrakech", "CMN": "Casablanca", "TUN": "Tunis", "ALG": "Alger", "DSS": "Dakar",
    "ABJ": "Abidjan", "NBO": "Nairobi", "JNB": "Johannesburg", "BOM": "Bombay Mumbai", "DEL": "Delhi New Delhi",
    "TPE": "Taipei Taïwan", "MNL": "Manille", "KUL": "Kuala Lumpur", "CGK": "Jakarta",
    "SFO": "San Francisco", "LAX": "Los Angeles", "MIA": "Miami", "JFK": "New York", "EWR": "New York",
    "BOS": "Boston", "ORD": "Chicago", "IAD": "Washington", "DCA": "Washington", "MUC": "Munich",
    "FRA": "Francfort", "VIE": "Vienne", "WAW": "Varsovie", "PRG": "Prague", "BRU": "Bruxelles",
    "GVA": "Genève", "ZRH": "Zurich", "AMS": "Amsterdam", "EDI": "Édimbourg", "DUB": "Dublin",
    "SVQ": "Séville", "MAD": "Madrid", "NAP": "Naples", "MXP": "Milan", "LIN": "Milan",
}

def keywords(r):
    kws = [k.strip() for k in r["keywords"].split(",") if k.strip().isascii() and len(k.strip()) <= 30]
    extra = ALIASES.get(r["iata_code"].strip(), "")
    return " ".join(kws[:5] + [extra]).strip()

out = []
for r in csv.DictReader(open(oa_path, encoding="utf-8")):
    iata = r["iata_code"].strip()
    if not iata or len(iata) != 3 or r["scheduled_service"] != "yes":
        continue
    if r["type"] not in ("large_airport", "medium_airport"):
        continue
    lat, lon = float(r["latitude_deg"]), float(r["longitude_deg"])
    src = tzdb.get(r["icao_code"] or r["ident"]) or by_iata.get(iata)
    tz = src["tz"] if src and src.get("tz") else nearest_tz(lat, lon)
    out.append([iata, r["name"], r["municipality"], r["iso_country"], round(lat, 3), round(lon, 3), tz, 1 if r["type"] == "large_airport" else 0, keywords(r)])

out.sort(key=lambda a: (-a[7], a[0]))
json.dump(out, open("src/data/airports.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(len(out), "airports")
