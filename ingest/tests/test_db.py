"""Sport-code slugify (pure half of the auto-create-sport path)."""

from massif_ingest import db


def test_slugify_sport():
    assert db.slugify_sport("Surfing") == "surfing"
    assert db.slugify_sport("GravelRide") == "gravel_ride"          # camel/Pascal split
    assert db.slugify_sport("open_water_swimming") == "open_water_swimming"
    assert db.slugify_sport("Stand Up Paddling") == "stand_up_paddling"
    assert db.slugify_sport("E-Bike Ride") == "e_bike_ride"
    assert db.slugify_sport("") == "unknown"                        # never empty -> safe fallback
