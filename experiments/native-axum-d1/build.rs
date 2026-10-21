fn main() {
    connectrpc_build::Config::new()
        .files(&["../workers-connect-d1/proto/experiment/v1/task.proto"])
        .includes(&["../workers-connect-d1/proto/"])
        .include_file("_connectrpc.rs")
        .compile()
        .expect("generate the same RPC schema as the Workers experiment");
}
