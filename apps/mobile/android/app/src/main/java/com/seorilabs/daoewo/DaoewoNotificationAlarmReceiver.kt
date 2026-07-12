package com.seorilabs.daoewo

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class DaoewoNotificationAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      DaoewoNotificationScheduler.ACTION_DAILY ->
        DaoewoNotificationScheduler.deliverDaily(context)
      DaoewoNotificationScheduler.ACTION_REVIEW ->
        DaoewoNotificationScheduler.deliverReview(context)
    }
  }
}
