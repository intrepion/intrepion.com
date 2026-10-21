FROM rust:1-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends protobuf-compiler && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY proto ./proto
COPY server ./server
# Default features deliberately omit the local authentication endpoint.
RUN cargo build --locked --release -p intrepion-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10001 app
COPY --from=build /app/target/release/intrepion-server /usr/local/bin/intrepion-server
USER 10001
ENV PORT=8788
EXPOSE 8788
CMD ["/usr/local/bin/intrepion-server"]
