package com.seorilabs.daoewo

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class NativeDaoewoNotificationsPackage : BaseReactPackage() {
  override fun getModule(
    name: String,
    reactContext: ReactApplicationContext,
  ): NativeModule? = if (name == NativeDaoewoNotificationsModule.NAME) {
    NativeDaoewoNotificationsModule(reactContext)
  } else {
    null
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider {
      mapOf(
        NativeDaoewoNotificationsModule.NAME to ReactModuleInfo(
          NativeDaoewoNotificationsModule.NAME,
          NativeDaoewoNotificationsModule::class.java.name,
          false,
          false,
          false,
          true,
        ),
      )
    }
}
