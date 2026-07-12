package com.seorilabs.daoewo

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener

@ReactModule(name = NativeDaoewoNotificationsModule.NAME)
class NativeDaoewoNotificationsModule(
  reactContext: ReactApplicationContext,
) : NativeDaoewoNotificationsSpec(reactContext) {
  private data class PendingPreferences(
    val dailyReminder: Boolean,
    val reviewReminder: Boolean,
    val nextReviewAtEpochMs: Long,
    val promise: Promise,
  )

  private var pendingPermissionCompletion: ((Boolean) -> Unit)? = null

  override fun requestPermission(promise: Promise) {
    runOnUiThread {
      requestNotificationPermission { granted -> promise.resolve(granted) }
    }
  }

  override fun applyPreferences(
    dailyReminder: Boolean,
    reviewReminder: Boolean,
    nextReviewAtEpochMs: Double,
    promise: Promise,
  ) {
    if (!nextReviewAtEpochMs.isFinite() ||
      (nextReviewAtEpochMs != NO_REVIEW_AT && nextReviewAtEpochMs <= 0)
    ) {
      promise.reject(ERROR_INVALID_REVIEW_AT, "복습 알림 시각이 올바르지 않아요.")
      return
    }
    val pending = PendingPreferences(
      dailyReminder,
      reviewReminder,
      nextReviewAtEpochMs.toLong(),
      promise,
    )
    runOnUiThread {
      if (!dailyReminder && !reviewReminder) {
        applyAndResolve(pending)
      } else {
        requestNotificationPermission { granted ->
          if (granted) {
            applyAndResolve(pending)
          } else {
            pending.promise.reject(
              ERROR_PERMISSION_DENIED,
              "알림 권한이 허용되지 않았어요.",
            )
          }
        }
      }
    }
  }

  override fun clear(promise: Promise) {
    runOnUiThread {
      val pendingCompletion = pendingPermissionCompletion
      pendingPermissionCompletion = null
      pendingCompletion?.invoke(false)
      try {
        DaoewoNotificationScheduler.clear(reactApplicationContext)
        promise.resolve(null)
      } catch (error: RuntimeException) {
        promise.reject(ERROR_SCHEDULE_FAILED, "알림을 해제하지 못했어요.", error)
      }
    }
  }

  private fun requestNotificationPermission(onResult: (Boolean) -> Unit) {
    try {
      DaoewoNotificationScheduler.ensureChannel(reactApplicationContext)
    } catch (_: RuntimeException) {
      onResult(false)
      return
    }

    val postNotificationsGranted =
      Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        reactApplicationContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
    if (hasNotificationRuntimePermission(Build.VERSION.SDK_INT, postNotificationsGranted)) {
      onResult(
        runCatching {
          DaoewoNotificationScheduler.canPostNotifications(reactApplicationContext)
        }.getOrDefault(false),
      )
      return
    }
    if (pendingPermissionCompletion !== null) {
      onResult(false)
      return
    }
    val activity = reactApplicationContext.currentActivity
    if (activity !is PermissionAwareActivity) {
      onResult(false)
      return
    }

    pendingPermissionCompletion = onResult
    try {
      activity.requestPermissions(
        arrayOf(Manifest.permission.POST_NOTIFICATIONS),
        PERMISSION_REQUEST_CODE,
        PermissionListener { requestCode, _, grantResults ->
          if (requestCode != PERMISSION_REQUEST_CODE) {
            return@PermissionListener false
          }
          val completion = pendingPermissionCompletion
          pendingPermissionCompletion = null
          val granted =
            grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED &&
              runCatching {
                DaoewoNotificationScheduler.canPostNotifications(reactApplicationContext)
              }.getOrDefault(false)
          completion?.invoke(granted)
          true
        },
      )
    } catch (_: RuntimeException) {
      pendingPermissionCompletion = null
      onResult(false)
    }
  }

  private fun applyAndResolve(pending: PendingPreferences) {
    try {
      DaoewoNotificationScheduler.ensureChannel(reactApplicationContext)
      if ((pending.dailyReminder || pending.reviewReminder) &&
        !DaoewoNotificationScheduler.canPostNotifications(reactApplicationContext)
      ) {
        pending.promise.reject(
          ERROR_PERMISSION_DENIED,
          "시스템 설정에서 다외워 알림을 허용해 주세요.",
        )
        return
      }
      DaoewoNotificationScheduler.applyPreferences(
        reactApplicationContext,
        pending.dailyReminder,
        pending.reviewReminder,
        pending.nextReviewAtEpochMs,
      )
      pending.promise.resolve(null)
    } catch (error: RuntimeException) {
      pending.promise.reject(
        ERROR_SCHEDULE_FAILED,
        "알림을 예약하지 못했어요.",
        error,
      )
    }
  }

  override fun invalidate() {
    val pendingCompletion = pendingPermissionCompletion
    pendingPermissionCompletion = null
    pendingCompletion?.invoke(false)
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
    const val NAME = NativeDaoewoNotificationsSpec.NAME

    private const val NO_REVIEW_AT = -1.0
    private const val PERMISSION_REQUEST_CODE = 7_710
    private const val ERROR_INVALID_REVIEW_AT = "E_NOTIFICATION_INVALID_REVIEW_AT"
    private const val ERROR_PERMISSION_DENIED = "E_NOTIFICATION_PERMISSION_DENIED"
    private const val ERROR_SCHEDULE_FAILED = "E_NOTIFICATION_SCHEDULE_FAILED"
  }
}
