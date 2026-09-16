package com.tutelage.crm.counsellor.ui.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.tutelage.crm.counsellor.ui.MainScreen
import com.tutelage.crm.counsellor.ui.auth.LoginScreen
import com.tutelage.crm.counsellor.ui.auth.SessionViewModel

object Routes {
    const val LOGIN = "login"
    const val MAIN = "main"
}

@Composable
fun AppNav(sessionVm: SessionViewModel = hiltViewModel()) {
    val navController = rememberNavController()
    val isLoggedIn by sessionVm.isLoggedIn.collectAsStateWithLifecycle()
    val start = if (isLoggedIn) Routes.MAIN else Routes.LOGIN

    // If the AuthInterceptor wipes the session mid-use (server kicked us out),
    // bounce the user back to Login.
    LaunchedEffect(isLoggedIn) {
        if (!isLoggedIn && navController.currentDestination?.route != Routes.LOGIN) {
            navController.navigate(Routes.LOGIN) {
                popUpTo(0) { inclusive = true }
            }
        }
    }

    NavHost(navController = navController, startDestination = start) {
        composable(Routes.LOGIN) {
            LoginScreen(onSuccess = {
                navController.navigate(Routes.MAIN) {
                    popUpTo(Routes.LOGIN) { inclusive = true }
                }
            })
        }
        composable(Routes.MAIN) {
            MainScreen(onLoggedOut = {
                navController.navigate(Routes.LOGIN) {
                    popUpTo(0) { inclusive = true }
                }
            })
        }
    }
}
