"""Unit tests for the Flask backend of the M1-M5 gross-motor AAC web prototype."""

from pathlib import Path

from app import create_app


def test_index_and_health(tmp_path: Path):
    app = create_app(data_dir=tmp_path)
    client = app.test_client()

    health_res = client.get("/api/health")
    assert health_res.status_code == 200
    assert health_res.get_json()["status"] == "ok"

    index_res = client.get("/")
    assert index_res.status_code == 200
    html = index_res.get_data(as_text=True)
    assert "M1 · Left" in html
    assert "M5 · Open ↔ Fist" in html


def test_config_get_update_and_reset(tmp_path: Path):
    app = create_app(data_dir=tmp_path)
    client = app.test_client()

    initial = client.get("/api/config").get_json()
    assert set(initial["groups"].keys()) == {"G1", "G2", "G3", "G4", "G5"}
    assert initial["groups"]["G1"]["phrases"]["left"] == "我想喝水"

    # Update one phrase + clamp out-of-range settings
    update_res = client.post(
        "/api/config",
        json={
            "groups": {
                "G1": {
                    "title": "飲水與飲食",
                    "phrases": {"left": "請給我溫開水"},
                }
            },
            "settings": {
                "dwellMs": 50,         # clamped to 250
                "deadzoneRadius": 0.2,
                "m5Mode": "transition",
                "speechEnabled": False,
            },
        },
    )
    assert update_res.status_code == 200
    updated = update_res.get_json()
    assert updated["groups"]["G1"]["title"] == "飲水與飲食"
    assert updated["groups"]["G1"]["phrases"]["left"] == "請給我溫開水"
    assert updated["groups"]["G1"]["phrases"]["up"] == "我肚子餓了，想吃東西"
    assert updated["settings"]["dwellMs"] == 250
    assert updated["settings"]["deadzoneRadius"] == 0.2
    assert updated["settings"]["m5Mode"] == "transition"
    assert updated["settings"]["speechEnabled"] is False

    # Persisted across fresh read
    reloaded = client.get("/api/config").get_json()
    assert reloaded["groups"]["G1"]["phrases"]["left"] == "請給我溫開水"

    # Reset restores defaults
    reset_res = client.post("/api/config/reset")
    assert reset_res.status_code == 200
    reset_cfg = reset_res.get_json()
    assert reset_cfg["groups"]["G1"]["phrases"]["left"] == "我想喝水"
    assert reset_cfg["settings"]["speechEnabled"] is True


def test_events_lifecycle(tmp_path: Path):
    app = create_app(data_dir=tmp_path)
    client = app.test_client()

    assert client.get("/api/events").get_json()["events"] == []

    # Reject empty text
    bad_res = client.post("/api/events", json={"text": "   "})
    assert bad_res.status_code == 400

    # Create two events
    res1 = client.post(
        "/api/events",
        json={
            "groupId": "G1",
            "groupTitle": "生理需求",
            "motion": "M1→M5",
            "direction": "left",
            "text": "我想喝水",
            "source": "camera",
            "triggerDetail": "握拳→張掌",
        },
    )
    assert res1.status_code == 201
    res2 = client.post(
        "/api/events",
        json={
            "groupId": "G3",
            "groupTitle": "日常回應",
            "motion": "M3→M5",
            "direction": "right",
            "text": "謝謝你的幫忙",
            "source": "simulator",
            "triggerDetail": "半張掌駐留",
        },
    )
    assert res2.status_code == 201

    events = client.get("/api/events").get_json()["events"]
    assert len(events) == 2
    assert events[0]["text"] == "謝謝你的幫忙"
    assert events[1]["text"] == "我想喝水"

    # Clear history
    clear_res = client.delete("/api/events")
    assert clear_res.status_code == 200
    assert client.get("/api/events").get_json()["events"] == []
