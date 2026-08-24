.PHONY: help setup-hooks format format-check lint typecheck audit web-check check

help:
	@echo "Targets:"
	@echo "  setup-hooks   Point git at .githooks (installs the pre-commit check)"
	@echo "  format        Auto-format with Prettier"
	@echo "  format-check  Check formatting with Prettier"
	@echo "  lint          Lint the bot with Oxlint"
	@echo "  typecheck     Type-check the bot with tsc"
	@echo "  audit         Scan dependencies for known vulnerabilities (yarn npm audit)"
	@echo "  web-check     Type/diagnostic-check the web frontend with svelte-check"
	@echo "  check         Run format-check + lint + typecheck + audit + web-check"

setup-hooks:
	git config core.hooksPath .githooks
	chmod +x .githooks/pre-commit
	@echo "Git hooks installed: core.hooksPath -> .githooks"

format:
	yarn format

format-check:
	yarn format:check

lint:
	yarn lint

typecheck:
	yarn typecheck

audit:
	yarn npm audit

web-check:
	yarn web:check

check:
	yarn check
