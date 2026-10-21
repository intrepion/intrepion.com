fn main() {
    connectrpc_build::Config::new()
        .files(&["proto/experiment/v1/task.proto"])
        .includes(&["proto/"])
        .include_file("_connectrpc.rs")
        .compile()
        .expect("generate the experiment RPC service");
}
