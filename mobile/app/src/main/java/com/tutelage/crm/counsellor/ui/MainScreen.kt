@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.tutelage.crm.counsellor.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.outlined.FactCheck
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.tutelage.crm.counsellor.ui.calls.CallsScreen
import com.tutelage.crm.counsellor.ui.bucket.BucketScreen
import com.tutelage.crm.counsellor.ui.filterleads.FilterBatchDetailScreen
import com.tutelage.crm.counsellor.ui.filterleads.FilterBatchListScreen
import com.tutelage.crm.counsellor.ui.followups.FollowupsListScreen
import com.tutelage.crm.counsellor.ui.home.HomeScreen
import com.tutelage.crm.counsellor.ui.inactivity.InactivityHost
import com.tutelage.crm.counsellor.ui.location.MandatoryLocationHost
import com.tutelage.crm.counsellor.data.auth.TokenStore
import androidx.hilt.navigation.compose.hiltViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import com.tutelage.crm.counsellor.ui.leads.LeadDetailScreen
import com.tutelage.crm.counsellor.ui.leads.LeadListScreen
import com.tutelage.crm.counsellor.ui.profile.ProfileScreen
import com.tutelage.crm.counsellor.ui.tasks.TasksScreen
import com.tutelage.crm.counsellor.ui.update.MandatoryUpdateHost
import java.net.URLDecoder
import java.net.URLEncoder

@HiltViewModel
class LocationGateViewModel @javax.inject.Inject constructor(val tokenStore: TokenStore) : androidx.lifecycle.ViewModel()

private sealed class Tab(
    val route: String,
    val label: String,
    val icon: ImageVector,
    val iconSelected: ImageVector,
) {
    data object Home : Tab("home", "Home", Icons.Outlined.Home, Icons.Filled.Home)
    data object Leads : Tab("leads", "Leads", Icons.Outlined.Group, Icons.Filled.Group)
    data object Filter : Tab("filter-leads", "Filter", Icons.Outlined.FactCheck, Icons.Filled.FactCheck)
    data object Bucket : Tab("bucket", "Bucket", Icons.Outlined.Inbox, Icons.Filled.Inbox)
    data object Calls : Tab("calls", "Calls", Icons.Outlined.Call, Icons.Filled.Call)
    data object Profile : Tab("profile", "Profile", Icons.Outlined.Person, Icons.Filled.Person)
}

private val tabs = listOf(Tab.Home, Tab.Leads, Tab.Bucket, Tab.Filter, Tab.Calls, Tab.Profile)

@Composable
fun MainScreen(onLoggedOut: () -> Unit, tokenStore: TokenStore = hiltViewModelTokenStore()) {
    val navController = rememberNavController()
    val showBucket by tokenStore.showBucketFlow.collectAsStateWithLifecycle()
    val visibleTabs = if (showBucket) tabs else tabs.filter { it != Tab.Bucket }
    val backStack by navController.currentBackStackEntryAsState()
    val currentRoute = backStack?.destination?.route
    val showBottomBar = visibleTabs.any { it.route == currentRoute } || currentRoute == null
    val snackbarHostState = remember { SnackbarHostState() }

    Scaffold(
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
        bottomBar = {
            if (showBottomBar) {
                val cs = MaterialTheme.colorScheme
                NavigationBar(
                    containerColor = cs.surface,
                    tonalElevation = 6.dp,
                ) {
                    visibleTabs.forEach { tab ->
                        val selected = backStack?.destination?.hierarchy?.any { it.route == tab.route } == true
                        NavigationBarItem(
                            selected = selected,
                            onClick = {
                                if (!selected) {
                                    navController.navigate(tab.route) {
                                        popUpTo(Tab.Home.route) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                }
                            },
                            icon = { Icon(if (selected) tab.iconSelected else tab.icon, contentDescription = tab.label) },
                            label = { Text(tab.label) },
                            colors = NavigationBarItemDefaults.colors(
                                indicatorColor = cs.primaryContainer,
                                selectedIconColor = cs.primary,
                                selectedTextColor = cs.primary,
                                unselectedIconColor = cs.onSurfaceVariant,
                                unselectedTextColor = cs.onSurfaceVariant,
                            ),
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = Tab.Home.route,
            modifier = Modifier.padding(padding),
        ) {
            composable(Tab.Home.route) {
                HomeScreen(
                    onOpenFollowups = { bucket -> navController.navigate("followups/$bucket") },
                    // Auto-dialer disabled — feature commented out.
                    // onOpenAutoDialer = { navController.navigate("auto-dialer") },
                    onOpenLead = { id -> navController.navigate("leads/$id") },
                    onOpenTasks = { navController.navigate("tasks") },
                )
            }
            composable("tasks") {
                TasksScreen(
                    onBack = { navController.popBackStack() },
                    onOpenBatch = { batchId, ids, title ->
                        val encodedTitle = URLEncoder.encode(title, "UTF-8")
                        navController.navigate("task-leads/$batchId/$encodedTitle/$ids")
                    },
                    onAutoDial = { batchId -> navController.navigate("task-auto-dialer/$batchId") },
                )
            }
            composable("task-auto-dialer/{batchId}") { backStackEntry ->
                val batchId = backStackEntry.arguments?.getString("batchId")?.toLongOrNull() ?: 0L
                com.tutelage.crm.counsellor.ui.tasks.TaskAutoDialerScreen(
                    batchId = batchId,
                    onBack = { navController.popBackStack() },
                )
            }
            composable("task-leads/{batchId}/{title}/{ids}") { backStackEntry ->
                val batchId = backStackEntry.arguments?.getString("batchId")?.toLongOrNull() ?: 0L
                val title = backStackEntry.arguments?.getString("title")
                    ?.let { runCatching { URLDecoder.decode(it, "UTF-8") }.getOrDefault(it) }
                // Still passed so the screen has the task's leads before the
                // first response lands; the batch id is what actually scopes
                // and orders the list server-side.
                val ids = backStackEntry.arguments?.getString("ids")
                    ?.split(",")?.mapNotNull { it.trim().toLongOrNull() }
                    ?: emptyList()
                LeadListScreen(
                    onLeadClick = { id -> navController.navigate("leads/$id") },
                    onLogout = onLoggedOut,
                    onBack = { navController.popBackStack() },
                    taskIds = ids,
                    taskTitle = title,
                    taskBatchId = batchId,
                )
            }
            // Auto-dialer disabled — route commented out.
            // composable("auto-dialer") {
            //     com.tutelage.crm.counsellor.autodialer.AutoDialerCampaignListScreen(
            //         onBack = { navController.popBackStack() },
            //     )
            // }
            composable("followups/{bucket}") { backStackEntry ->
                val bucket = backStackEntry.arguments?.getString("bucket") ?: "today"
                FollowupsListScreen(
                    bucket = bucket,
                    onBack = { navController.popBackStack() },
                    onOpenLead = { id -> navController.navigate("leads/$id") },
                )
            }
            composable(Tab.Leads.route) {
                LeadListScreen(
                    onLeadClick = { id -> navController.navigate("leads/$id") },
                    onLogout = onLoggedOut,
                )
            }
            if (showBucket) composable(Tab.Bucket.route) { BucketScreen(onOpenLead = { id -> navController.navigate("leads/$id") }) }
            composable(Tab.Calls.route) { CallsScreen() }
            composable(Tab.Profile.route) { ProfileScreen(onLogout = onLoggedOut) }
            composable(Tab.Filter.route) {
                FilterBatchListScreen(
                    onOpenBatch = { batchId -> navController.navigate("filter-leads/$batchId") },
                )
            }
            composable("filter-leads/{batchId}") { backStackEntry ->
                val batchId = backStackEntry.arguments?.getString("batchId")?.toLongOrNull() ?: 0L
                FilterBatchDetailScreen(
                    batchId = batchId,
                    onBack = { navController.popBackStack() },
                    onOpenLead = { id -> navController.navigate("leads/$id") },
                )
            }
            composable("leads/{id}") { backStackEntry ->
                val id = backStackEntry.arguments?.getString("id")?.toLongOrNull() ?: 0L
                LeadDetailScreen(leadId = id, onBack = { navController.popBackStack() })
            }
        }

        // Global overlay — polls /activity/status, shows the warning snackbar
        // and the blocking Mark-as-Read dialog. Combined web+app idle window
        // is enforced server-side; this only renders the in-app surface.
        InactivityHost(snackbarHostState = snackbarHostState)

        // Global overlay — blocks the entire app behind a non-dismissible
        // dialog when the latest release is marked mandatory.
        MandatoryUpdateHost()
        MandatoryLocationHost(tokenStore)
    }
}

@Composable
private fun hiltViewModelTokenStore(): TokenStore = androidx.hilt.navigation.compose.hiltViewModel<LocationGateViewModel>().tokenStore
