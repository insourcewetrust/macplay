"""Build src/data/airlines.json ([iata, icao, name]) from OpenFlights airlines.dat."""
import csv, json, sys

rows = {}
for r in csv.reader(open(sys.argv[1], encoding="utf-8")):
    _, name, _, iata, icao, _, _, active = r
    if len(iata) != 2 or len(icao) != 3 or not iata.isalnum() or icao == "\\N":
        continue
    if iata in rows and rows[iata][3] == "Y":
        continue
    rows[iata] = [iata, icao, name, active]
out = sorted([r[:3] for r in rows.values() if r[3] == "Y"])
json.dump(out, open("src/data/airlines.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(len(out), "airlines")
