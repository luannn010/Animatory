"""Persistence tests for StudioStore — projects must survive a 'restart'
(a fresh store instance pointed at the same SQLite file)."""
from __future__ import annotations

import pytest

from animatory.studio.models import Phase
from animatory.studio.store import ProjectNotFound, StudioStore


@pytest.mark.asyncio
async def test_created_project_persists_across_restart(tmp_path):
    db = str(tmp_path / "studio.db")

    s1 = StudioStore(db_path=db)
    await s1.init()
    created = await s1.create_project("My Saved Episode")
    pid = created.id
    seed_count = len(s1.list_projects())
    await s1.close()

    # Simulate a backend restart: brand-new store, same DB file.
    s2 = StudioStore(db_path=db)
    await s2.init()
    got = s2.get_project(pid)
    assert got.title == "My Saved Episode"
    # Seeds are still there too (created project + seeds).
    assert len(s2.list_projects()) == seed_count
    await s2.close()


@pytest.mark.asyncio
async def test_rename_and_advance_persist(tmp_path):
    db = str(tmp_path / "studio.db")

    s1 = StudioStore(db_path=db)
    await s1.init()
    await s1.update_title("ep02", "Renamed Persisted")
    await s1.advance_phase("ep02", Phase.pre)
    await s1.close()

    s2 = StudioStore(db_path=db)
    await s2.init()
    p = s2.get_project("ep02")
    assert p.title == "Renamed Persisted"
    assert p.current_phase == Phase.pre
    assert p.phases[Phase.parse] == p.phases[Phase.parse].complete
    await s2.close()


@pytest.mark.asyncio
async def test_new_counter_does_not_collide_after_restart(tmp_path):
    db = str(tmp_path / "studio.db")

    s1 = StudioStore(db_path=db)
    await s1.init()
    first = await s1.create_project("One")
    await s1.close()

    s2 = StudioStore(db_path=db)
    await s2.init()
    second = await s2.create_project("Two")
    # The restored counter must not reuse the previous id.
    assert second.id != first.id
    # Both survive.
    assert {first.id, second.id} <= {p.id for p in s2.list_projects()}
    await s2.close()


@pytest.mark.asyncio
async def test_unknown_project_raises(tmp_path):
    s = StudioStore(db_path=str(tmp_path / "studio.db"))
    await s.init()
    with pytest.raises(ProjectNotFound):
        s.get_project("does-not-exist")
    await s.close()
