# Standalone SDL dependencies

- JSON for Modern C++ 3.12.0: https://github.com/nlohmann/json/tree/v3.12.0 (MIT, JSON-LICENSE).
- PicoSHA2 1.0.1: https://github.com/okdshin/PicoSHA2/tree/v1.0.1 (MIT, PICOSHA2-LICENSE).
- HTTPS uses the platform libcurl with certificate and hostname verification enabled. Windows distributes libcurl runtime dependencies and CA certificates with their license notices.

The read-only localStorage migration follows Google LevelDB and Snappy's published formats. It never writes to the old browser profile and only considers live manifest entries for the exact app origin and login key.
