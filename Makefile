.PHONY: check catalog test test-py test-ts docs docs-build

check:
	uv run --package mykit-cli mykit check

catalog:
	uv run --package mykit-cli mykit catalog

test: test-py test-ts

test-py:
	uv sync --all-packages
	uv run pytest

test-ts:
	npm install
	npm test

docs:
	npm install
	npm run docs:dev -- --open

docs-build:
	npm install
	npm run docs:build
