package com.clawchat.android.feature.home

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.ui.ClawTopBarColors
import com.clawchat.android.core.ui.RegisterPrimaryAction
import com.clawchat.android.core.ui.TaskCreateSheet
import com.clawchat.android.core.ui.icons.ClawIcons
import com.clawchat.android.core.ui.localizedErrorMessage
import com.clawchat.android.core.ui.theme.clawSemanticColors

/**
 * The home list: one row per place in the app, each one tap away. Rows that
 * need a server are shown only with [showServerFeatures]; [isLocalOnly]
 * labels Settings with the device instead of a connection.
 */
@Composable
fun HomeScreen(
    showServerFeatures: Boolean,
    isLocalOnly: Boolean,
    onOpenInbox: () -> Unit = {},
    onOpenToday: () -> Unit = {},
    onOpenSchedule: () -> Unit = {},
    onOpenTasks: () -> Unit = {},
    onOpenProgress: () -> Unit = {},
    onOpenProject: (String) -> Unit = {},
    onOpenAllProjects: () -> Unit = {},
    onOpenChat: () -> Unit = {},
    onOpenDevices: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    onOpenSearch: () -> Unit = {},
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var showCreateSheet by remember { mutableStateOf(false) }

    // Counts and rings go stale while another screen is open; reread on return.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.refresh() }

    val errorMessage = state.error?.let { localizedErrorMessage(it) }
    LaunchedEffect(errorMessage) {
        val message = errorMessage ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(message)
        viewModel.clearError()
    }

    RegisterPrimaryAction("home", stringResource(R.string.home_cd_new_task)) { showCreateSheet = true }

    HomeContent(
        state = state,
        showServerFeatures = showServerFeatures,
        isLocalOnly = isLocalOnly,
        snackbarHostState = snackbarHostState,
        onOpenInbox = onOpenInbox,
        onOpenToday = onOpenToday,
        onOpenSchedule = onOpenSchedule,
        onOpenTasks = onOpenTasks,
        onOpenProgress = onOpenProgress,
        onOpenProject = onOpenProject,
        onOpenAllProjects = onOpenAllProjects,
        onOpenChat = onOpenChat,
        onOpenDevices = onOpenDevices,
        onOpenSettings = onOpenSettings,
        onOpenSearch = onOpenSearch,
    )

    if (showCreateSheet) {
        TaskCreateSheet(
            onDismiss = { showCreateSheet = false },
            onCreate = { data ->
                viewModel.createTask(data)
                showCreateSheet = false
            },
        )
    }
}

/** The screen for one state, without its view model; [HomeScreen] wires it up. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun HomeContent(
    state: HomeUiState,
    showServerFeatures: Boolean,
    isLocalOnly: Boolean,
    snackbarHostState: SnackbarHostState,
    onOpenInbox: () -> Unit,
    onOpenToday: () -> Unit,
    onOpenSchedule: () -> Unit,
    onOpenTasks: () -> Unit,
    onOpenProgress: () -> Unit,
    onOpenProject: (String) -> Unit,
    onOpenAllProjects: () -> Unit,
    onOpenChat: () -> Unit,
    onOpenDevices: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenSearch: () -> Unit,
) {
    val semantic = clawSemanticColors()
    val grey = MaterialTheme.colorScheme.onSurfaceVariant
    val shownProjects = state.projects.take(HomeViewModel.PROJECT_ROWS)

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.home_title),
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold,
                    )
                },
                colors = ClawTopBarColors(),
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            // Room under the last row for the + button.
            contentPadding = PaddingValues(bottom = 88.dp),
        ) {
            item { SearchField(onClick = onOpenSearch) }
            if (showServerFeatures) {
                item {
                    HomeRow(
                        icon = ClawIcons.Inbox,
                        tint = MaterialTheme.colorScheme.primary,
                        label = stringResource(R.string.home_inbox),
                        onClick = onOpenInbox,
                    )
                }
            }
            item {
                HomeRow(
                    icon = Icons.Default.Star,
                    tint = semantic.today,
                    label = stringResource(R.string.home_today),
                    onClick = onOpenToday,
                )
            }
            item {
                HomeRow(
                    icon = ClawIcons.Today,
                    tint = semantic.deadline,
                    label = stringResource(R.string.home_schedule),
                    onClick = onOpenSchedule,
                )
            }
            item {
                HomeRow(
                    icon = ClawIcons.Checklist,
                    tint = semantic.tasks,
                    label = stringResource(R.string.home_tasks),
                    onClick = onOpenTasks,
                )
            }
            if (showServerFeatures) {
                item {
                    val busy = state.checkCount > 0 || state.runningCount > 0
                    HomeRow(
                        icon = ClawIcons.Schedule,
                        tint = grey,
                        label = stringResource(R.string.home_progress),
                        onClick = onOpenProgress,
                    ) {
                        Text(
                            text = if (busy) {
                                stringResource(R.string.home_progress_counts, state.checkCount, state.runningCount)
                            } else {
                                "0"
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (busy) semantic.needsInput else grey,
                        )
                    }
                }
                if (shownProjects.isNotEmpty()) {
                    item { SectionHeader(stringResource(R.string.home_projects)) }
                    items(shownProjects, key = HomeProject::id) { project ->
                        ProjectRow(project = project, onClick = { onOpenProject(project.id) })
                    }
                    if (state.projects.size > shownProjects.size) {
                        item {
                            HomeRow(
                                icon = null,
                                tint = grey,
                                label = stringResource(R.string.home_projects_all),
                                labelColor = MaterialTheme.colorScheme.primary,
                                onClick = onOpenAllProjects,
                            )
                        }
                    }
                }
                item {
                    HomeRow(
                        icon = ClawIcons.Chat,
                        tint = grey,
                        label = stringResource(R.string.home_chat),
                        onClick = onOpenChat,
                    )
                }
                item {
                    HomeRow(
                        icon = ClawIcons.PhoneAndroid,
                        tint = grey,
                        label = stringResource(R.string.home_devices),
                        onClick = onOpenDevices,
                    )
                }
            }
            item {
                HomeRow(
                    icon = Icons.Default.Settings,
                    tint = grey,
                    label = stringResource(R.string.home_settings),
                    onClick = onOpenSettings,
                    divider = false,
                ) {
                    when {
                        isLocalOnly || !showServerFeatures -> Text(
                            text = stringResource(R.string.home_this_device),
                            style = MaterialTheme.typography.bodyMedium,
                            color = grey,
                        )
                        else -> ConnectionState(
                            connected = state.isConnected,
                            connectedColor = semantic.connected,
                            grey = grey,
                        )
                    }
                }
            }
        }
    }
}

/** Looks like a search box; the real field lives on the search screen. */
@Composable
private fun SearchField(onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainer,
    ) {
        Row(
            modifier = Modifier
                .height(44.dp)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Default.Search,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = stringResource(R.string.home_search),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private val RowIconSize = 24.dp
private val RowIconGap = 16.dp

@Composable
private fun HomeRow(
    icon: ImageVector?,
    tint: Color,
    label: String,
    onClick: () -> Unit,
    labelColor: Color = MaterialTheme.colorScheme.onSurface,
    divider: Boolean = true,
    trailing: (@Composable () -> Unit)? = null,
) {
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp)
                .clickable(onClick = onClick)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier.size(RowIconSize),
                    tint = tint,
                )
            } else {
                Spacer(Modifier.width(RowIconSize))
            }
            Spacer(Modifier.width(RowIconGap))
            Text(
                text = label,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyLarge,
                color = labelColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (trailing != null) {
                Spacer(Modifier.width(12.dp))
                trailing()
            }
        }
        if (divider) RowDivider()
    }
}

@Composable
private fun RowDivider() {
    HorizontalDivider(
        modifier = Modifier.padding(start = 16.dp + RowIconSize + RowIconGap),
        color = MaterialTheme.colorScheme.outlineVariant,
    )
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 6.dp),
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun ProjectRow(project: HomeProject, onClick: () -> Unit) {
    val progressDescription = stringResource(R.string.home_cd_project_progress, project.done, project.total)
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 52.dp)
                .clickable(onClick = onClick)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Sits where the row icon would, so titles line up with the rows above.
            Box(modifier = Modifier.size(RowIconSize), contentAlignment = Alignment.Center) {
                ProgressRing(
                    fraction = project.fraction,
                    modifier = Modifier
                        .size(14.dp)
                        .semantics { contentDescription = progressDescription },
                )
            }
            Spacer(Modifier.width(RowIconGap))
            Text(
                text = project.title,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        RowDivider()
    }
}

/** A grey track with a blue arc for the share of tasks that are done. */
@Composable
private fun ProgressRing(fraction: Float, modifier: Modifier = Modifier) {
    val track = MaterialTheme.colorScheme.outlineVariant
    val fill = MaterialTheme.colorScheme.primary
    Canvas(modifier = modifier) {
        val stroke = Stroke(width = 2.5.dp.toPx())
        val inset = stroke.width / 2
        val arcSize = Size(size.width - stroke.width, size.height - stroke.width)
        drawArc(
            color = track,
            startAngle = 0f,
            sweepAngle = 360f,
            useCenter = false,
            topLeft = Offset(inset, inset),
            size = arcSize,
            style = stroke,
        )
        if (fraction > 0f) {
            drawArc(
                color = fill,
                startAngle = -90f,
                sweepAngle = 360f * fraction,
                useCenter = false,
                topLeft = Offset(inset, inset),
                size = arcSize,
                style = stroke,
            )
        }
    }
}

@Composable
private fun ConnectionState(connected: Boolean, connectedColor: Color, grey: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .background(if (connected) connectedColor else grey, CircleShape),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            text = stringResource(if (connected) R.string.home_connected else R.string.home_disconnected),
            style = MaterialTheme.typography.bodyMedium,
            color = grey,
        )
    }
}
