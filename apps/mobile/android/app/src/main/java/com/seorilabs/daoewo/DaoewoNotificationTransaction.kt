package com.seorilabs.daoewo

internal inline fun runDaoewoNotificationTransaction(
  applyAlarms: () -> Unit,
  commitPreferences: () -> Boolean,
  rollback: () -> Unit,
) {
  try {
    applyAlarms()
    if (!commitPreferences()) {
      throw IllegalStateException("알림 설정을 저장하지 못했어요.")
    }
  } catch (error: RuntimeException) {
    try {
      rollback()
    } catch (rollbackError: RuntimeException) {
      error.addSuppressed(rollbackError)
    }
    throw error
  }
}
