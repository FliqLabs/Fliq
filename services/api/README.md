# services/api

The fliq API, MCP server, webhook dispatcher, rate sampler and chain watcher. Owner: Dipo.

Today this folder holds a mock server that serves `spec/fixtures` so the web and iOS apps can build against real HTTP from day 1. Replace it with the real service; keep `make dev-mock` working, because judges run it.

```
make dev-mock                                  # http://localhost:4000/v1
curl localhost:4000/v1/rates/usdc/ngn
curl -X POST localhost:4000/v1/quote -H "Authorization: Bearer rt_test_7Kp2demo00c9Qe"
```

Configuration: copy `.env.example` to `.env`. Mock mode needs no secrets.
