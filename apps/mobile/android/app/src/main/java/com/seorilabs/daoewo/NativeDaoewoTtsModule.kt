package com.seorilabs.daoewo

import android.speech.tts.TextToSpeech
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.annotations.ReactModule
import java.util.Locale

@ReactModule(name = NativeDaoewoTtsModule.NAME)
class NativeDaoewoTtsModule(
  reactContext: ReactApplicationContext,
) : NativeDaoewoTtsSpec(reactContext), LifecycleEventListener {
  private enum class EngineState {
    UNINITIALIZED,
    INITIALIZING,
    READY,
    DESTROYED,
  }

  private data class SpeechRequest(
    val text: String,
    val localeTag: String,
    val promise: Promise,
  )

  private var engine: TextToSpeech? = null
  private var engineState = EngineState.UNINITIALIZED
  private var engineGeneration = 0L
  private var utteranceSequence = 0L
  private val pendingRequests = mutableListOf<SpeechRequest>()

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun speak(text: String, locale: String, promise: Promise) {
    val normalizedText = text.trim()
    if (normalizedText.isEmpty()) {
      promise.reject(ERROR_EMPTY_TEXT, "읽을 텍스트가 비어 있어요.")
      return
    }
    if (normalizedText.length > MAX_INPUT_LENGTH) {
      promise.reject(
        ERROR_TEXT_TOO_LONG,
        "읽을 텍스트는 ${MAX_INPUT_LENGTH}자 이하여야 해요.",
      )
      return
    }
    val normalizedLocale = locale.trim()
    if (normalizedLocale.isEmpty()) {
      promise.reject(ERROR_LANGUAGE_UNAVAILABLE, "TTS 언어가 지정되지 않았어요.")
      return
    }

    runOnUiThread {
      enqueueSpeech(SpeechRequest(normalizedText, normalizedLocale, promise))
    }
  }

  override fun stop(promise: Promise) {
    runOnUiThread {
      rejectPending(ERROR_STOPPED, "TTS 재생이 중지되었어요.")
      val result = try {
        engine?.stop()
      } catch (error: RuntimeException) {
        promise.reject(ERROR_UNAVAILABLE, "TTS를 중지하지 못했어요.", error)
        return@runOnUiThread
      }
      if (result == TextToSpeech.ERROR) {
        promise.reject(ERROR_UNAVAILABLE, "TTS를 중지하지 못했어요.")
      } else {
        promise.resolve(null)
      }
    }
  }

  private fun enqueueSpeech(request: SpeechRequest) {
    when (engineState) {
      EngineState.DESTROYED ->
        request.promise.reject(ERROR_UNAVAILABLE, "TTS module이 종료되었어요.")
      EngineState.READY -> speakNow(request)
      EngineState.INITIALIZING -> {
        rejectPending(ERROR_INTERRUPTED, "새 TTS 요청으로 교체되었어요.")
        pendingRequests.add(request)
      }
      EngineState.UNINITIALIZED -> {
        pendingRequests.add(request)
        initializeEngine()
      }
    }
  }

  private fun initializeEngine() {
    engineState = EngineState.INITIALIZING
    val generation = ++engineGeneration
    try {
      engine = TextToSpeech(reactApplicationContext.applicationContext) { status ->
        // 일부 엔진은 자체 binder thread에서 callback을 보내므로 상태 처리는 UI thread로 모은다.
        UiThreadUtil.runOnUiThread {
          handleInitialization(generation, status)
        }
      }
    } catch (error: RuntimeException) {
      engineState = EngineState.UNINITIALIZED
      engine = null
      rejectPending(ERROR_UNAVAILABLE, "TTS engine을 초기화하지 못했어요.", error)
    }
  }

  private fun handleInitialization(generation: Long, status: Int) {
    if (generation != engineGeneration || engineState != EngineState.INITIALIZING) {
      return
    }
    val initializedEngine = engine
    if (status != TextToSpeech.SUCCESS || initializedEngine == null) {
      initializedEngine?.shutdown()
      engine = null
      engineState = EngineState.UNINITIALIZED
      rejectPending(ERROR_UNAVAILABLE, "사용 가능한 TTS engine이 없어요.")
      return
    }

    engineState = EngineState.READY
    val requests = pendingRequests.toList()
    pendingRequests.clear()
    requests.forEach(::speakNow)
  }

  private fun speakNow(request: SpeechRequest) {
    val activeEngine = engine
    if (activeEngine == null || engineState != EngineState.READY) {
      request.promise.reject(ERROR_UNAVAILABLE, "TTS engine이 준비되지 않았어요.")
      return
    }

    val locale = Locale.forLanguageTag(request.localeTag)
    if (locale.language.isBlank()) {
      request.promise.reject(
        ERROR_LANGUAGE_UNAVAILABLE,
        "지원하지 않는 TTS 언어예요: ${request.localeTag}",
      )
      return
    }

    try {
      if (activeEngine.isLanguageAvailable(locale) < TextToSpeech.LANG_AVAILABLE ||
        activeEngine.setLanguage(locale) < TextToSpeech.LANG_AVAILABLE
      ) {
        request.promise.reject(
          ERROR_LANGUAGE_UNAVAILABLE,
          "설치된 TTS voice가 없어요: ${request.localeTag}",
        )
        return
      }
      val result = activeEngine.speak(
        request.text,
        TextToSpeech.QUEUE_FLUSH,
        null,
        "daoewo-tts-${++utteranceSequence}",
      )
      if (result == TextToSpeech.ERROR) {
        request.promise.reject(ERROR_UNAVAILABLE, "TTS 재생을 시작하지 못했어요.")
      } else {
        // Android speak()는 queue 수락 여부를 동기 반환하며 실제 합성은 비동기로 진행된다.
        request.promise.resolve(null)
      }
    } catch (error: RuntimeException) {
      request.promise.reject(ERROR_UNAVAILABLE, "TTS 재생을 시작하지 못했어요.", error)
    }
  }

  private fun rejectPending(code: String, message: String, error: Throwable? = null) {
    val requests = pendingRequests.toList()
    pendingRequests.clear()
    requests.forEach { request ->
      if (error == null) {
        request.promise.reject(code, message)
      } else {
        request.promise.reject(code, message, error)
      }
    }
  }

  private fun releaseEngine(permanently: Boolean) {
    if (engineState == EngineState.DESTROYED && !permanently) {
      return
    }
    ++engineGeneration
    rejectPending(ERROR_UNAVAILABLE, "TTS engine이 종료되었어요.")
    val activeEngine = engine
    try {
      activeEngine?.stop()
    } catch (_: RuntimeException) {
      // Lifecycle cleanup은 engine 구현 오류가 있어도 shutdown까지 진행한다.
    } finally {
      try {
        activeEngine?.shutdown()
      } catch (_: RuntimeException) {
        // 종료 중인 React context로 native engine 예외를 전파하지 않는다.
      } finally {
        engine = null
        engineState = if (permanently) {
          EngineState.DESTROYED
        } else {
          EngineState.UNINITIALIZED
        }
      }
    }
  }

  override fun onHostResume() = Unit

  override fun onHostPause() = Unit

  override fun onHostDestroy() {
    runOnUiThread {
      releaseEngine(permanently = false)
    }
  }

  override fun invalidate() {
    reactApplicationContext.removeLifecycleEventListener(this)
    runOnUiThread {
      releaseEngine(permanently = true)
    }
    super.invalidate()
  }

  private fun runOnUiThread(block: () -> Unit) {
    if (UiThreadUtil.isOnUiThread()) {
      block()
    } else {
      UiThreadUtil.runOnUiThread { block() }
    }
  }

  companion object {
    const val NAME = NativeDaoewoTtsSpec.NAME

    private const val MAX_INPUT_LENGTH = 4_000
    private const val ERROR_EMPTY_TEXT = "E_TTS_EMPTY_TEXT"
    private const val ERROR_TEXT_TOO_LONG = "E_TTS_TEXT_TOO_LONG"
    private const val ERROR_LANGUAGE_UNAVAILABLE = "E_TTS_LANGUAGE_UNAVAILABLE"
    private const val ERROR_UNAVAILABLE = "E_TTS_UNAVAILABLE"
    private const val ERROR_INTERRUPTED = "E_TTS_INTERRUPTED"
    private const val ERROR_STOPPED = "E_TTS_STOPPED"
  }
}
