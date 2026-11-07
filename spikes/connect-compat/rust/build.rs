fn main() {
    connectrpc_build::Config::new()
        .files(&["../proto/spike/v1/compatibility.proto"])
        .includes(&["../proto"])
        .include_file("_connectrpc.rs")
        .compile()
        .expect("generate the compatibility service with protoc");
}
