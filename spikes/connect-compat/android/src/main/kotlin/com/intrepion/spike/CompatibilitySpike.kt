package com.intrepion.spike

import com.connectrpc.Code
import com.connectrpc.ProtocolClientConfig
import com.connectrpc.ResponseMessage
import com.connectrpc.extensions.GoogleJavaProtobufStrategy
import com.connectrpc.getOrThrow
import com.connectrpc.impl.ProtocolClient
import com.connectrpc.okhttp.ConnectOkHttpClient
import com.connectrpc.protocols.NetworkProtocol
import com.intrepion.spike.v1.CompatibilityServiceClient
import com.intrepion.spike.v1.PingRequest
import kotlinx.coroutines.Dispatchers
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** Invoke from an Android coroutine; throws if either compatibility check fails. */
suspend fun runCompatibilitySpike(): String {
    val http = OkHttpClient.Builder().callTimeout(10, TimeUnit.SECONDS).build()
    val client = CompatibilityServiceClient(
        ProtocolClient(
            httpClient = ConnectOkHttpClient(http),
            ProtocolClientConfig(
                host = "http://127.0.0.1:4100",
                serializationStrategy = GoogleJavaProtobufStrategy(),
                networkProtocol = NetworkProtocol.CONNECT,
                ioCoroutineContext = Dispatchers.IO,
            ),
        ),
    )
    try {
        val reply = client.ping(PingRequest.newBuilder().setClientName("  Android  ").build()).getOrThrow()
        check(reply.message == "Hello, Android!") { "Unexpected greeting: ${reply.message}" }
        check(reply.server == "connect-rust/axum") { "Unexpected server: ${reply.server}" }
        val invalid = client.ping(PingRequest.newBuilder().setClientName("  ").build())
        check(invalid is ResponseMessage.Failure && invalid.cause.code == Code.INVALID_ARGUMENT) {
            "Expected INVALID_ARGUMENT, received $invalid"
        }
        return "PASS: Android greeting, server identity, and invalid_argument"
    } finally {
        http.dispatcher.executorService.shutdown()
        http.connectionPool.evictAll()
    }
}
