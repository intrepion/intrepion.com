package com.intrepion.spike

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.widget.TextView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Disposable startup probe, not production UI/lifecycle architecture. */
class MainActivity : Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val view = TextView(this)
        view.text = "Running dummy RPC checks"
        setContentView(view)

        CoroutineScope(Dispatchers.Main).launch {
            try {
                val result = runCompatibilitySpike()
                view.text = result
                Log.i("ConnectSpike", result)
            } catch (e: Throwable) {
                view.text = "FAIL: $e"
                Log.e("ConnectSpike", "FAIL", e)
            }
        }
    }
}
