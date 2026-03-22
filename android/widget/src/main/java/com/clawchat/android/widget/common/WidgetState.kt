package com.clawchat.android.widget.common

sealed interface WidgetState<out T> {
    data object Loading : WidgetState<Nothing>
    data object NotLoggedIn : WidgetState<Nothing>
    data class Success<T>(val data: T) : WidgetState<T>
    data class Error(val message: String) : WidgetState<Nothing>
}
