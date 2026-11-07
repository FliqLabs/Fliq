.PHONY: help setup dev-mock test test-spec test-api test-web test-contract test-sandbox build-contract ios

help:
	@echo "make setup          install everything a fresh clone needs"
	@echo "make dev-mock       run the API in mock mode on http://localhost:4000/v1"
	@echo "make test           run every test suite that exists"
	@echo "make test-spec      lint the API spec and check fixtures and generated types"
	@echo "make test-api       typecheck and test the API"
	@echo "make test-web       lint, typecheck and build the web app"
	@echo "make build-contract build release WASMs with cargo near"
	@echo "make test-contract  fmt, clippy and test the vault contract"
	@echo "make test-sandbox   build release WASMs and run near-workspaces"
	@echo "make ios            generate the Xcode project from apps/ios/project.yml"

setup:
	corepack enable
	pnpm install --frozen-lockfile

dev-mock:
	pnpm --filter @fliq/api dev:mock

test: test-spec test-api test-web test-contract

test-spec:
	pnpm --filter @fliq/spec test

test-api:
	pnpm --filter @fliq/api typecheck
	pnpm --filter @fliq/api test

test-web:
	@if [ -f apps/web/package.json ]; then \
		pnpm --filter ./apps/web run --if-present lint && \
		pnpm --filter ./apps/web run --if-present typecheck && \
		pnpm --filter ./apps/web run --if-present build; \
	else echo "apps/web not scaffolded yet"; fi

test-contract:
	@if [ -f contracts/vault/Cargo.toml ]; then \
		cd contracts/vault && cargo fmt --check && cargo clippy --lib --test contract -- -D warnings && cargo test --lib --test contract; \
	else echo "contracts/vault not scaffolded yet"; fi

build-contract:
	cd contracts/vault && cargo near build non-reproducible-wasm --no-abi
	cd contracts/mock_usdc && cargo near build non-reproducible-wasm --no-abi

test-sandbox: build-contract
	cd contracts/vault && cargo test --test workspaces

ios:
	cd apps/ios && xcodegen generate
