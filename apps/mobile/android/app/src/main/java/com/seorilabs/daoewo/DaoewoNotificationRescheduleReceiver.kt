package com.seorilabs.daoewo

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class DaoewoNotificationRescheduleReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      Intent.ACTION_TIME_CHANGED,
      Intent.ACTION_TIMEZONE_CHANGED -> DaoewoNotificationScheduler.reschedule(context)
    }
  }
}
