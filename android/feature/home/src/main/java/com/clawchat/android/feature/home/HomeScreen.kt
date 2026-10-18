package com.clawchat.android.feature.home

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.ui.RegisterPrimaryAction
import com.clawchat.android.core.ui.TaskCreateSheet
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
    onOpenSettings: () -> Unit,
    onOpenSearch: () -> Unit,
) {
    val semantic = clawSemanticColors()
    val grey = MaterialTheme.colorScheme.onSurfaceVariant
    // Chat and Settings sit a step back from the places above them.
    val quiet = lerp(MaterialTheme.colorScheme.onSurface, grey, 0.5f)
    val amber = MaterialTheme.colorScheme.tertiary
    val shownProjects = state.projects.take(HomeViewModel.PROJECT_ROWS)

    Scaffold(
        // The whole screen is the sidebar of the desktop app.
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            // Room under the last row for the + button.
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 18.dp, bottom = 90.dp),
        ) {
            item { SearchField(onClick = onOpenSearch) }
            if (showServerFeatures) {
                item {
                    HomeRow(
                        icon = HomeIcons.Inbox,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        label = stringResource(R.string.home_inbox),
                        onClick = onOpenInbox,
                        trailing = countOrNull(state.inboxCount),
                    )
                }
            }
            item {
                HomeRow(
                    icon = HomeIcons.Star,
                    tint = semantic.today,
                    label = stringResource(R.string.home_today),
                    onClick = onOpenToday,
                    trailing = countOrNull(state.todayCount),
                )
            }
            item {
                HomeRow(
                    icon = HomeIcons.Calendar,
                    tint = semantic.deadline,
                    label = stringResource(R.string.home_schedule),
                    onClick = onOpenSchedule,
                )
            }
            item {
                HomeRow(
                    icon = HomeIcons.List,
                    tint = semantic.tasks,
                    label = stringResource(R.string.home_tasks),
                    onClick = onOpenTasks,
                    trailing = countOrNull(state.taskCount),
                )
            }
            if (showServerFeatures) {
                item {
                    // Quiet unless something waits: no "0" when nothing does.
                    val busy = state.checkCount > 0 || state.runningCount > 0
                    HomeRow(
                        icon = HomeIcons.Clock,
                        tint = amber,
                        label = stringResource(R.string.home_progress),
                        onClick = onOpenProgress,
                        trailing = if (busy) {
                            {
                                Text(
                                    text = stringResource(
                                        R.string.home_progress_counts,
                                        state.checkCount,
                                        state.runningCount,
                                    ),
                                    style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.5.sp),
                                    fontWeight = FontWeight.Bold,
                                    color = amber,
                                )
                            }
                        } else {
                            null
                        },
                    )
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
                                minHeight = 46.dp,
                                fontSize = 15.5.sp,
                            )
                        }
                    }
                }
                item { Spacer(Modifier.height(14.dp)) }
                item {
                    HomeRow(
                        icon = HomeIcons.Chat,
                        tint = quiet,
                        label = stringResource(R.string.home_chat),
                        labelColor = quiet,
                        onClick = onOpenChat,
                        minHeight = 46.dp,
                        fontSize = 15.sp,
                        iconSize = 19.dp,
                    )
                }
            }
            item {
                HomeRow(
                    icon = HomeIcons.Settings,
                    tint = quiet,
                    label = stringResource(R.string.home_settings),
                    labelColor = quiet,
                    onClick = onOpenSettings,
                    minHeight = 46.dp,
                    fontSize = 15.sp,
                    iconSize = 19.dp,
                ) {
                    when {
                        isLocalOnly || !showServerFeatures -> Text(
                            text = stringResource(R.string.home_this_device),
                            style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp),
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

/** A grey number beside a row, or nothing when there is nothing to count. */
private fun countOrNull(count: Int): (@Composable () -> Unit)? =
    if (count <= 0) {
        null
    } else {
        {
            Text(
                text = count.toString(),
                style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

/** Looks like a search box; the real field lives on the search screen. */
@Composable
private fun SearchField(onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 4.dp, end = 4.dp, bottom = 14.dp),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
    ) {
        Row(
            modifier = Modifier
                .height(44.dp)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                HomeIcons.Search,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = stringResource(R.string.home_search),
                style = MaterialTheme.typography.bodyLarge.copy(fontSize = 15.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

private val RowIconSlot = 20.dp
private val RowIconGap = 14.dp
private val RowShape = RoundedCornerShape(10.dp)

@Composable
private fun HomeRow(
    icon: ImageVector?,
    tint: Color,
    label: String,
    onClick: () -> Unit,
    labelColor: Color = MaterialTheme.colorScheme.onSurface,
    minHeight: Dp = 48.dp,
    fontSize: TextUnit = 16.sp,
    iconSize: Dp = RowIconSlot,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = minHeight)
            .clip(RowShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Every icon sits in the same slot, so the labels line up.
        Box(modifier = Modifier.size(RowIconSlot), contentAlignment = Alignment.Center) {
            if (icon != null) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier.size(iconSize),
                    tint = tint,
                )
            }
        }
        Spacer(Modifier.width(RowIconGap))
        Text(
            text = label,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyLarge.copy(fontSize = fontSize),
            color = labelColor,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (trailing != null) {
            Spacer(Modifier.width(12.dp))
            trailing()
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 12.dp, end = 12.dp, top = 18.dp, bottom = 4.dp),
        style = MaterialTheme.typography.labelLarge.copy(fontSize = 12.5.sp),
        fontWeight = FontWeight.SemiBold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun ProjectRow(project: HomeProject, onClick: () -> Unit) {
    val progressDescription = stringResource(R.string.home_cd_project_progress, project.done, project.total)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 46.dp)
            .clip(RowShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.size(RowIconSlot), contentAlignment = Alignment.Center) {
            ProgressPie(
                fraction = project.fraction,
                modifier = Modifier
                    .size(18.dp)
                    .semantics { contentDescription = progressDescription },
            )
        }
        Spacer(Modifier.width(RowIconGap))
        Text(
            text = project.title,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyLarge.copy(fontSize = 15.5.sp),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** A blue circle filled like a pie for the share of tasks that are done, as on the desktop sidebar. */
@Composable
private fun ProgressPie(fraction: Float, modifier: Modifier = Modifier) {
    val fill = MaterialTheme.colorScheme.primary
    Canvas(modifier = modifier) {
        val stroke = Stroke(width = 2.dp.toPx())
        val inset = stroke.width / 2
        drawArc(
            color = fill,
            startAngle = 0f,
            sweepAngle = 360f,
            useCenter = false,
            topLeft = Offset(inset, inset),
            size = Size(size.width - stroke.width, size.height - stroke.width),
            style = stroke,
        )
        if (fraction > 0f) {
            drawArc(
                color = fill,
                startAngle = -90f,
                sweepAngle = 360f * fraction,
                useCenter = true,
            )
        }
    }
}

@Composable
private fun ConnectionState(connected: Boolean, connectedColor: Color, grey: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(7.dp)
                .background(if (connected) connectedColor else grey, CircleShape),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            text = stringResource(if (connected) R.string.home_connected else R.string.home_disconnected),
            style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp),
            color = grey,
        )
    }
}
