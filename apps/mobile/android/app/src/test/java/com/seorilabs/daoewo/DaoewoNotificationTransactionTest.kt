package com.seorilabs.daoewo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.TimeZone

class DaoewoNotificationTransactionTest {
  @Test
  fun `Android 12 이하는 POST_NOTIFICATIONS runtime permission이 필요 없다`() {
    assertEquals(33, ANDROID_POST_NOTIFICATIONS_SDK_INT)
    assertEquals(true, hasNotificationRuntimePermission(32, false))
  }

  @Test
  fun `Android 13은 POST_NOTIFICATIONS 거부 상태를 허용으로 보지 않는다`() {
    assertEquals(false, hasNotificationRuntimePermission(33, false))
  }

  @Test
  fun `Android 13의 기존 granted 상태는 재요청 없이 사용한다`() {
    assertEquals(true, hasNotificationRuntimePermission(33, true))
  }

  @Test
  fun `review 예약 실패 시 기존 daily 예약을 복원한다`() {
    var dailyScheduled = true
    var reviewScheduled = false

    assertThrows(IllegalStateException::class.java) {
      runDaoewoNotificationTransaction(
        applyAlarms = {
          dailyScheduled = false
          throw IllegalStateException("review alarm failed")
        },
        commitPreferences = {
          reviewScheduled = true
          true
        },
        rollback = {
          dailyScheduled = true
          reviewScheduled = false
        },
      )
    }

    assertEquals(true, dailyScheduled)
    assertEquals(false, reviewScheduled)
  }

  @Test
  fun `preferences commit 실패 시 기존 예약을 복원한다`() {
    var dailyScheduled = true
    var reviewScheduled = false

    assertThrows(IllegalStateException::class.java) {
      runDaoewoNotificationTransaction(
        applyAlarms = {
          dailyScheduled = false
          reviewScheduled = true
        },
        commitPreferences = { false },
        rollback = {
          dailyScheduled = true
          reviewScheduled = false
        },
      )
    }

    assertEquals(true, dailyScheduled)
    assertEquals(false, reviewScheduled)
  }

  @Test
  fun `09시 전에는 같은 날 09시를 선택한다`() {
    val zoneId = ZoneId.of("Asia/Seoul")
    val timeZone = TimeZone.getTimeZone(zoneId)
    val now = epoch(zoneId, 2026, 7, 13, 8, 59)
    val expected = epoch(zoneId, 2026, 7, 13, 9, 0)

    assertEquals(expected, DaoewoNotificationScheduler.nextLocalNineAt(now, timeZone))
  }

  @Test
  fun `정확히 09시면 다음 날 09시를 선택한다`() {
    val zoneId = ZoneId.of("Asia/Seoul")
    val timeZone = TimeZone.getTimeZone(zoneId)
    val now = epoch(zoneId, 2026, 7, 13, 9, 0)
    val expected = epoch(zoneId, 2026, 7, 14, 9, 0)

    assertEquals(expected, DaoewoNotificationScheduler.nextLocalNineAt(now, timeZone))
  }

  @Test
  fun `DST 전환 뒤에도 현지 09시를 다시 계산한다`() {
    val zoneId = ZoneId.of("America/New_York")
    val timeZone = TimeZone.getTimeZone(zoneId)
    val beforeDst = epoch(zoneId, 2026, 3, 7, 10, 0)
    val expectedAfterDst = epoch(zoneId, 2026, 3, 8, 9, 0)

    assertEquals(
      expectedAfterDst,
      DaoewoNotificationScheduler.nextLocalNineAt(beforeDst, timeZone),
    )
  }

  @Test
  fun `같은 절대 시각도 변경된 timezone의 현지 09시로 계산한다`() {
    val now = ZonedDateTime.parse("2026-07-13T00:30:00Z").toInstant().toEpochMilli()
    val seoul = ZoneId.of("Asia/Seoul")
    val losAngeles = ZoneId.of("America/Los_Angeles")

    assertEquals(
      epoch(seoul, 2026, 7, 14, 9, 0),
      DaoewoNotificationScheduler.nextLocalNineAt(now, TimeZone.getTimeZone(seoul)),
    )
    assertEquals(
      epoch(losAngeles, 2026, 7, 13, 9, 0),
      DaoewoNotificationScheduler.nextLocalNineAt(now, TimeZone.getTimeZone(losAngeles)),
    )
  }

  private fun epoch(
    zoneId: ZoneId,
    year: Int,
    month: Int,
    day: Int,
    hour: Int,
    minute: Int,
  ): Long = ZonedDateTime.of(year, month, day, hour, minute, 0, 0, zoneId)
    .toInstant()
    .toEpochMilli()
}
