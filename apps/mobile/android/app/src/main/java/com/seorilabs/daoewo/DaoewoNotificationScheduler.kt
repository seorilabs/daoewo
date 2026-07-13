package com.seorilabs.daoewo

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import java.util.Calendar
import java.util.TimeZone

internal object DaoewoNotificationScheduler {
  private data class PreferencesSnapshot(
    val dailyReminder: Boolean,
    val reviewReminder: Boolean,
    val nextReviewAtEpochMs: Long,
    val hasDailyReminder: Boolean,
    val hasReviewReminder: Boolean,
    val hasNextReviewAt: Boolean,
  )

  const val ACTION_DAILY = "com.seorilabs.daoewo.notification.DAILY"
  const val ACTION_REVIEW = "com.seorilabs.daoewo.notification.REVIEW"

  private const val CHANNEL_ID = "daoewo_reminders"
  private const val DAILY_NOTIFICATION_ID = 7_711
  private const val REVIEW_NOTIFICATION_ID = 7_712
  private const val DAILY_ALARM_REQUEST_CODE = 7_721
  private const val REVIEW_ALARM_REQUEST_CODE = 7_722
  private const val OPEN_APP_REQUEST_CODE = 7_723
  private const val PREFERENCES_NAME = "daoewo-native-notifications-v1"
  private const val DAILY_ENABLED_KEY = "daily-enabled"
  private const val REVIEW_ENABLED_KEY = "review-enabled"
  private const val REVIEW_AT_KEY = "review-at"
  private const val NO_REVIEW_AT = -1L

  fun applyPreferences(
    context: Context,
    dailyReminder: Boolean,
    reviewReminder: Boolean,
    nextReviewAtEpochMs: Long,
  ) {
    val appContext = context.applicationContext
    ensureChannel(appContext)
    val previous = snapshot(appContext)
    runDaoewoNotificationTransaction(
      applyAlarms = {
        configureAlarms(
          appContext,
          dailyReminder,
          reviewReminder,
          nextReviewAtEpochMs,
        )
      },
      commitPreferences = {
        preferences(appContext).edit()
          .putBoolean(DAILY_ENABLED_KEY, dailyReminder)
          .putBoolean(REVIEW_ENABLED_KEY, reviewReminder)
          .putLong(REVIEW_AT_KEY, nextReviewAtEpochMs)
          .commit()
      },
      rollback = { restore(appContext, previous) },
    )
  }

  fun clear(context: Context) {
    val appContext = context.applicationContext
    val previous = snapshot(appContext)
    runDaoewoNotificationTransaction(
      applyAlarms = {
        configureAlarms(appContext, false, false, NO_REVIEW_AT)
      },
      commitPreferences = { preferences(appContext).edit().clear().commit() },
      rollback = { restore(appContext, previous) },
    )
    notificationManager(appContext).cancel(DAILY_NOTIFICATION_ID)
    notificationManager(appContext).cancel(REVIEW_NOTIFICATION_ID)
  }

  fun reschedule(context: Context) {
    val appContext = context.applicationContext
    val stored = snapshot(appContext)
    configureAlarms(
      appContext,
      stored.dailyReminder,
      stored.reviewReminder,
      stored.nextReviewAtEpochMs,
    )
  }

  fun deliverDaily(context: Context) {
    val appContext = context.applicationContext
    val stored = preferences(appContext)
    if (!stored.getBoolean(DAILY_ENABLED_KEY, false)) {
      return
    }
    postNotification(
      appContext,
      DAILY_NOTIFICATION_ID,
      "다외워 학습 시간",
      "오늘의 학습을 이어가 보세요.",
    )
    // 매번 현재 timezone으로 다음 local 09:00을 다시 계산해 DST와 지역 변경을 반영한다.
    scheduleDaily(appContext)
  }

  fun deliverReview(context: Context) {
    val appContext = context.applicationContext
    val stored = preferences(appContext)
    if (!stored.getBoolean(REVIEW_ENABLED_KEY, false) ||
      stored.getLong(REVIEW_AT_KEY, NO_REVIEW_AT) <= 0
    ) {
      return
    }
    postNotification(
      appContext,
      REVIEW_NOTIFICATION_ID,
      "복습할 시간이에요",
      "기억이 흐려지기 전에 복습을 시작해 보세요.",
    )
    stored.edit().putLong(REVIEW_AT_KEY, NO_REVIEW_AT).apply()
  }

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val channel = NotificationChannel(
      CHANNEL_ID,
      "학습 알림",
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = "매일 학습과 복습 예정 시각을 알려드려요."
    }
    notificationManager(context).createNotificationChannel(channel)
  }

  fun canPostNotifications(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      return false
    }
    val manager = notificationManager(context)
    if (!manager.areNotificationsEnabled()) {
      return false
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = manager.getNotificationChannel(CHANNEL_ID)
      if (channel?.importance == NotificationManager.IMPORTANCE_NONE) {
        return false
      }
    }
    return true
  }

  internal fun nextLocalNineAt(
    nowEpochMs: Long,
    timeZone: TimeZone = TimeZone.getDefault(),
  ): Long {
    val now = Calendar.getInstance(timeZone).apply { timeInMillis = nowEpochMs }
    val next = Calendar.getInstance(timeZone).apply {
      timeInMillis = nowEpochMs
      set(Calendar.HOUR_OF_DAY, 9)
      set(Calendar.MINUTE, 0)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }
    if (!next.after(now)) {
      next.add(Calendar.DAY_OF_YEAR, 1)
    }
    return next.timeInMillis
  }

  private fun scheduleDaily(context: Context) {
    scheduleAlarm(
      context,
      nextLocalNineAt(System.currentTimeMillis()),
      ACTION_DAILY,
      DAILY_ALARM_REQUEST_CODE,
    )
  }

  private fun scheduleReview(context: Context, requestedAt: Long) {
    val triggerAt = requestedAt.coerceAtLeast(System.currentTimeMillis() + 1_000L)
    scheduleAlarm(context, triggerAt, ACTION_REVIEW, REVIEW_ALARM_REQUEST_CODE)
  }

  private fun configureAlarms(
    context: Context,
    dailyReminder: Boolean,
    reviewReminder: Boolean,
    nextReviewAtEpochMs: Long,
  ) {
    if (dailyReminder) {
      scheduleDaily(context)
    } else {
      cancelAlarm(context, ACTION_DAILY, DAILY_ALARM_REQUEST_CODE)
    }
    if (reviewReminder && nextReviewAtEpochMs > 0) {
      scheduleReview(context, nextReviewAtEpochMs)
    } else {
      cancelAlarm(context, ACTION_REVIEW, REVIEW_ALARM_REQUEST_CODE)
    }
  }

  private fun scheduleAlarm(
    context: Context,
    triggerAt: Long,
    action: String,
    requestCode: Int,
  ) {
    val pendingIntent = checkNotNull(
      alarmPendingIntent(context, action, requestCode, PendingIntent.FLAG_UPDATE_CURRENT),
    ) {
      "알림 PendingIntent를 만들지 못했어요."
    }
    alarmManager(context).setAndAllowWhileIdle(
      AlarmManager.RTC_WAKEUP,
      triggerAt,
      pendingIntent,
    )
  }

  private fun cancelAlarm(context: Context, action: String, requestCode: Int) {
    val pendingIntent = alarmPendingIntent(
      context,
      action,
      requestCode,
      PendingIntent.FLAG_NO_CREATE,
    ) ?: return
    alarmManager(context).cancel(pendingIntent)
    pendingIntent.cancel()
  }

  private fun alarmPendingIntent(
    context: Context,
    action: String,
    requestCode: Int,
    creationFlag: Int,
  ): PendingIntent? = PendingIntent.getBroadcast(
    context,
    requestCode,
    Intent(context, DaoewoNotificationAlarmReceiver::class.java).setAction(action),
    creationFlag or PendingIntent.FLAG_IMMUTABLE,
  )

  private fun postNotification(
    context: Context,
    notificationId: Int,
    title: String,
    message: String,
  ) {
    ensureChannel(context)
    if (!canPostNotifications(context)) {
      return
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
    val notification = builder
      .setSmallIcon(R.drawable.ic_notification)
      .setContentTitle(title)
      .setContentText(message)
      .setCategory(Notification.CATEGORY_REMINDER)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
      .setAutoCancel(true)
      .setContentIntent(openAppPendingIntent(context))
      .build()
    notificationManager(context).notify(notificationId, notification)
  }

  private fun openAppPendingIntent(context: Context): PendingIntent =
    PendingIntent.getActivity(
      context,
      OPEN_APP_REQUEST_CODE,
      Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
      },
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  private fun preferences(context: Context) =
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  private fun snapshot(context: Context): PreferencesSnapshot {
    val stored = preferences(context)
    return PreferencesSnapshot(
      dailyReminder = stored.getBoolean(DAILY_ENABLED_KEY, false),
      reviewReminder = stored.getBoolean(REVIEW_ENABLED_KEY, false),
      nextReviewAtEpochMs = stored.getLong(REVIEW_AT_KEY, NO_REVIEW_AT),
      hasDailyReminder = stored.contains(DAILY_ENABLED_KEY),
      hasReviewReminder = stored.contains(REVIEW_ENABLED_KEY),
      hasNextReviewAt = stored.contains(REVIEW_AT_KEY),
    )
  }

  private fun restore(context: Context, previous: PreferencesSnapshot) {
    val editor = preferences(context).edit()
    if (previous.hasDailyReminder) {
      editor.putBoolean(DAILY_ENABLED_KEY, previous.dailyReminder)
    } else {
      editor.remove(DAILY_ENABLED_KEY)
    }
    if (previous.hasReviewReminder) {
      editor.putBoolean(REVIEW_ENABLED_KEY, previous.reviewReminder)
    } else {
      editor.remove(REVIEW_ENABLED_KEY)
    }
    if (previous.hasNextReviewAt) {
      editor.putLong(REVIEW_AT_KEY, previous.nextReviewAtEpochMs)
    } else {
      editor.remove(REVIEW_AT_KEY)
    }
    if (!editor.commit()) {
      throw IllegalStateException("기존 알림 설정을 복원하지 못했어요.")
    }
    configureAlarms(
      context,
      previous.dailyReminder,
      previous.reviewReminder,
      previous.nextReviewAtEpochMs,
    )
  }

  private fun alarmManager(context: Context): AlarmManager =
    context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
      ?: throw IllegalStateException("AlarmManager를 사용할 수 없어요.")

  private fun notificationManager(context: Context): NotificationManager =
    context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      ?: throw IllegalStateException("NotificationManager를 사용할 수 없어요.")
}
