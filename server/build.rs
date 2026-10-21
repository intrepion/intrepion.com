fn main() {
    println!("cargo:rerun-if-changed=../proto/life/v1/tasks.proto");
    connectrpc_build::Config::new()
        .files(&["../proto/life/v1/tasks.proto"])
        .includes(&["../proto"])
        .include_file("_connectrpc.rs")
        .compile()
        .expect("generate ConnectRPC service");
}
