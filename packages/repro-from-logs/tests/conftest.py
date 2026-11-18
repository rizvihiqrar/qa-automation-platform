import pytest

from repro.server import Pool


@pytest.fixture(scope="session")
def pool():
    pool = Pool()
    yield pool
    pool.close()
