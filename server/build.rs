fn main() {
    println!("cargo:rerun-if-changed=../proto/life/v1/accounts.proto");
    println!("cargo:rerun-if-changed=../proto/life/v1/operator.proto");
    println!("cargo:rerun-if-changed=../proto/life/v1/households.proto");
    println!("cargo:rerun-if-changed=../proto/life/v1/tasks.proto");
    println!("cargo:rerun-if-changed=../proto/life/v1/lists.proto");
    connectrpc_build::Config::new()
        .files(&[
            "../proto/life/v1/tasks.proto",
            "../proto/life/v1/lists.proto",
            "../proto/life/v1/households.proto",
            "../proto/life/v1/operator.proto",
            "../proto/life/v1/accounts.proto",
        ])
        .includes(&["../proto"])
        .include_file("_connectrpc.rs")
        .compile()
        .expect("generate ConnectRPC service");
}
