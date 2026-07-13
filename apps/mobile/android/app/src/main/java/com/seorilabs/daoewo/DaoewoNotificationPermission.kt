package com.seorilabs.daoewo

internal const val ANDROID_POST_NOTIFICATIONS_SDK_INT = 33

internal fun hasNotificationRuntimePermission(
  sdkInt: Int,
  postNotificationsGranted: Boolean,
): Boolean =
  sdkInt < ANDROID_POST_NOTIFICATIONS_SDK_INT || postNotificationsGranted
