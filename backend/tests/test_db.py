from backend.db.db import get_connection, init_db

EXPECTED_TABLES = {
    "products",
    "scene_states",
    "events",
    "planner_recommendations",
    "product_rules",
    "custom_rules",
    "feedback",
    "session_ratings",
}


def test_init_db_creates_expected_tables(tmp_path):
    db_path = tmp_path / "test.db"
    conn = get_connection(db_path)
    init_db(conn)

    tables = {
        row["name"]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    conn.close()

    assert EXPECTED_TABLES.issubset(tables)


def test_init_db_is_idempotent_on_existing_schema(tmp_path):
    db_path = tmp_path / "test.db"
    conn = get_connection(db_path)
    init_db(conn)
    init_db(conn)  # must not raise, thanks to CREATE TABLE IF NOT EXISTS
    conn.close()


def test_products_table_accepts_a_row(tmp_path):
    db_path = tmp_path / "test.db"
    conn = get_connection(db_path)
    init_db(conn)

    conn.execute(
        "INSERT INTO products (product_id, class_name, mass_class, fragility) "
        "VALUES (?, ?, ?, ?)",
        ("p1", "carton", "medium", "low"),
    )
    conn.commit()

    row = conn.execute(
        "SELECT * FROM products WHERE product_id = ?", ("p1",)
    ).fetchone()
    conn.close()

    assert row["class_name"] == "carton"
