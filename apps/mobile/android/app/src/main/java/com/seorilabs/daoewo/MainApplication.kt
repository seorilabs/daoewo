package com.seorilabs.daoewo

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList = PackageList(this).packages.apply {
        add(NativeDaoewoTtsPackage())
        add(NativeDaoewoNotificationsPackage())
      },
    )
  }

  override fun onCreate() {
    super.onCreate()
    // FCM이 background에서 process를 시작해도 표시 전에 기본 channel이 존재해야 한다.
    DaoewoNotificationScheduler.ensureChannel(this)
    loadReactNative(this)
  }
}
