// ===== AUTO-DIALER DISABLED (feature no longer in use) =====
// The entire file below is commented out. Wiring was also removed/commented in:
//   MainScreen.kt (nav route), HomeScreen.kt (AutoDialerCard), NetworkModule.kt
//   (provideAutoDialerApi), AndroidManifest.xml (CampaignRunnerActivity).
// To re-enable: strip the leading '// ' from each line and restore that wiring.
// ============================================================

// package com.tutelage.crm.counsellor.autodialer
//
// import androidx.compose.foundation.clickable
// import androidx.compose.foundation.layout.*
// import androidx.compose.foundation.lazy.LazyColumn
// import androidx.compose.foundation.lazy.items
// import androidx.compose.foundation.shape.RoundedCornerShape
// import androidx.compose.material.icons.Icons
// import androidx.compose.material.icons.automirrored.filled.ArrowBack
// import androidx.compose.material.icons.filled.PhoneInTalk
// import androidx.compose.material3.*
// import androidx.compose.runtime.*
// import androidx.compose.ui.Alignment
// import androidx.compose.ui.Modifier
// import androidx.compose.ui.platform.LocalContext
// import androidx.compose.ui.text.font.FontWeight
// import androidx.compose.ui.unit.dp
// import androidx.hilt.navigation.compose.hiltViewModel
// import androidx.lifecycle.ViewModel
// import androidx.lifecycle.viewModelScope
// import com.tutelage.crm.counsellor.data.autodialer.AutoDialerApi
// import com.tutelage.crm.counsellor.data.autodialer.CampaignDto
// import dagger.hilt.android.lifecycle.HiltViewModel
// import kotlinx.coroutines.flow.MutableStateFlow
// import kotlinx.coroutines.flow.StateFlow
// import kotlinx.coroutines.launch
// import javax.inject.Inject
//
// @HiltViewModel
// class AutoDialerListViewModel @Inject constructor(
//     private val api: AutoDialerApi,
// ) : ViewModel() {
//     private val _state = MutableStateFlow<List<CampaignDto>>(emptyList())
//     val state: StateFlow<List<CampaignDto>> = _state
//
//     private val _loading = MutableStateFlow(true)
//     val loading: StateFlow<Boolean> = _loading
//
//     init { refresh() }
//
//     fun refresh() {
//         viewModelScope.launch {
//             _loading.value = true
//             runCatching { api.campaigns() }
//                 .onSuccess { _state.value = it.data.filter { c -> c.status == "active" || c.status == "paused" } }
//             _loading.value = false
//         }
//     }
// }
//
// @OptIn(ExperimentalMaterial3Api::class)
// @Composable
// fun AutoDialerCampaignListScreen(
//     onBack: () -> Unit,
//     vm: AutoDialerListViewModel = hiltViewModel(),
// ) {
//     val list by vm.state.collectAsState()
//     val loading by vm.loading.collectAsState()
//     val context = LocalContext.current
//
//     Scaffold(
//         topBar = {
//             TopAppBar(
//                 title = { Text("Auto Dialer Campaigns") },
//                 navigationIcon = {
//                     IconButton(onClick = onBack) {
//                         Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
//                     }
//                 },
//             )
//         },
//     ) { padding ->
//         if (loading && list.isEmpty()) {
//             Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
//                 CircularProgressIndicator()
//             }
//             return@Scaffold
//         }
//         if (list.isEmpty()) {
//             Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
//                 Text("No campaigns assigned to you yet", color = MaterialTheme.colorScheme.onSurfaceVariant)
//             }
//             return@Scaffold
//         }
//         LazyColumn(
//             modifier = Modifier.fillMaxSize().padding(padding),
//             contentPadding = PaddingValues(16.dp),
//             verticalArrangement = Arrangement.spacedBy(10.dp),
//         ) {
//             items(list) { camp ->
//                 Card(
//                     modifier = Modifier.fillMaxWidth().clickable {
//                         context.startActivity(CampaignRunnerActivity.newIntent(context, camp.id))
//                     },
//                     shape = RoundedCornerShape(14.dp),
//                 ) {
//                     Row(modifier = Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
//                         Icon(
//                             Icons.Default.PhoneInTalk,
//                             contentDescription = null,
//                             tint = MaterialTheme.colorScheme.primary,
//                             modifier = Modifier.size(28.dp),
//                         )
//                         Spacer(Modifier.width(12.dp))
//                         Column(modifier = Modifier.weight(1f)) {
//                             Text(camp.name, fontWeight = FontWeight.SemiBold)
//                             Text(
//                                 "${camp.totalContacts} contacts · gap ${camp.callGapSec}s",
//                                 style = MaterialTheme.typography.bodySmall,
//                                 color = MaterialTheme.colorScheme.onSurfaceVariant,
//                             )
//                         }
//                         AssistChip(
//                             onClick = {},
//                             label = { Text(camp.status, style = MaterialTheme.typography.labelSmall) },
//                         )
//                     }
//                 }
//             }
//         }
//     }
// }
//
